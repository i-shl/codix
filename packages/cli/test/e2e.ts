/**
 * CLI 端到端驱动
 *
 * 起一个假的 OpenAI 兼容服务，用临时 HOME 跑真实的 dist/index.js，
 * 通过管道喂按键、读输出，验证整条链路（配置 → context → 渲染 → 工具 → 会话）。
 *
 * node --experimental-strip-types test/e2e.ts
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'dist', 'index.js');

// ---------------- 假模型服务 ----------------

interface Turn {
  /** 文本增量 */
  text?: string;
  /** 工具调用 */
  tool?: { name: string; args: Record<string, unknown> };
  reasoning?: string;
}

class MockModel {
  server: http.Server;
  port = 0;
  turns: Turn[] = [];
  private cursor = 0;
  requests: unknown[] = [];

  constructor() {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (!req.url?.includes('/chat/completions')) {
          res.writeHead(404).end('nope');
          return;
        }
        try {
          this.requests.push(JSON.parse(body));
        } catch {
          this.requests.push(body);
        }
        const turn = this.turns[this.cursor] ?? { text: '（没有更多剧本了）' };
        this.cursor++;
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const send = (obj: unknown): void => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        if (turn.reasoning) {
          send({ choices: [{ delta: { reasoning_content: turn.reasoning } }] });
        }
        if (turn.text) {
          // 拆成多个增量，模拟真实流式
          for (const chunk of turn.text.match(/[\s\S]{1,8}/g) ?? []) {
            send({ choices: [{ delta: { content: chunk } }] });
          }
        }
        if (turn.tool) {
          send({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: `call_${this.cursor}`,
                      function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) },
                    },
                  ],
                },
              },
            ],
          });
          send({ choices: [{ finish_reason: 'tool_calls' }] });
        } else {
          send({ choices: [{ finish_reason: 'stop' }] });
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    const addr = this.server.address();
    if (addr && typeof addr === 'object') this.port = addr.port;
  }

  /** 设置剧本并把游标归零（每个用例独立） */
  script(turns: Turn[]): void {
    this.turns = turns;
    this.cursor = 0;
    this.requests = [];
  }

  /**
   * 用例之间必须清干净：turns 重新赋值不会把 cursor 归零，
   * 上一个用例吃掉几条剧本，下一个用例就会拿到「没有更多剧本了」。
   */
  reset(): void {
    this.script([]);
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  get baseURL(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }
}

// ---------------- 受控子进程 ----------------

const ESC = '\x1b';

class CliSession {
  proc!: ChildProcessWithoutNullStreams;
  out = '';
  err = '';
  /** 进程退出码，退出前为 null。必须自己记：exit 事件只触发一次，晚挂的监听器收不到 */
  exit: number | null = null;
  home: string;
  cwd: string;
  args: string[];

  constructor(home: string, cwd: string, args: string[] = []) {
    this.home = home;
    this.cwd = cwd;
    this.args = args;
  }

  start(): void {
    this.proc = spawn(process.execPath, [ENTRY, ...this.args], {
      cwd: this.cwd,
      env: {
        ...process.env,
        HOME: this.home,
        USERPROFILE: this.home,
        voked_FORCE_TTY: '1',
        voked_LOG_LEVEL: 'error',
        NO_COLOR: '1',
        COLUMNS: '80',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (d: string) => (this.out += d));
    this.proc.stderr.on('data', (d: string) => (this.err += d));
    this.proc.on('exit', (c) => (this.exit = c ?? 0));
  }

  send(s: string): void {
    this.proc.stdin.write(s);
  }

  /** 一行输入 + 回车 */
  type(s: string): void {
    this.send(s);
    this.send('\r');
  }

  /** 等到输出里出现某个片段（已剥 ANSI） */
  async waitFor(needle: string | RegExp, timeoutMs = 12000): Promise<void> {
    const started = Date.now();
    for (;;) {
      const plain = strip(this.out);
      if (typeof needle === 'string' ? plain.includes(needle) : needle.test(plain)) return;
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `等待超时: ${String(needle)}\n---- stdout ----\n${plain.slice(-2500)}\n---- stderr ----\n${this.err.slice(-800)}`
        );
      }
      await sleep(40);
    }
  }

  async waitExit(timeoutMs = 8000): Promise<number> {
    const started = Date.now();
    while (this.exit === null) {
      if (Date.now() - started > timeoutMs) {
        this.proc.kill();
        return -1;
      }
      await sleep(30);
    }
    return this.exit;
  }

  kill(): void {
    if (!this.proc.killed) this.proc.kill();
  }

  get plain(): string {
    return strip(this.out);
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- 测试脚手架 ----------------

let passed = 0;
const failures: string[] = [];
let mock!: MockModel;

/**
 * 每个用例都拿一份全新的 HOME：/model 会把偏好写回全局配置，
 * 共用 HOME 会让上个用例的 mock-smart 漏到下个用例里。
 */
async function test(name: string, fn: (home: string) => Promise<void>): Promise<void> {
  try {
    mock.reset();
    const home = await makeHome(mock);
    await fn(home);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`  ✗ ${name}`);
  }
}

async function makeHome(mock: MockModel): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'voked-e2e-'));
  await fs.mkdir(path.join(home, '.voked'), { recursive: true });
  await fs.writeFile(
    path.join(home, '.voked', 'config.json'),
    JSON.stringify(
      {
        defaultModel: 'fast',
        providers: {
          mock: { label: 'Mock 供应商', type: 'openai-compatible', apiKey: 'sk-test', baseURL: mock.baseURL },
          other: { label: '另一个供应商', type: 'openai-compatible', apiKey: 'sk-test2', baseURL: mock.baseURL },
        },
        models: {
          fast: { provider: 'openai-compatible', providerId: 'mock', model: 'mock-fast' },
          smart: { provider: 'openai-compatible', providerId: 'mock', model: 'mock-smart' },
          alt: { provider: 'openai-compatible', providerId: 'other', model: 'alt-model' },
        },
        permissionRules: [],
        mcpServers: [],
      },
      null,
      2
    ),
    'utf8'
  );
  return home;
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'voked-proj-'));
  await fs.writeFile(path.join(dir, 'hello.txt'), 'voked E2E 标记行\n第二行\n', 'utf8');
  return dir;
}

// ---------------- 用例 ----------------

async function main(): Promise<void> {
  mock = new MockModel();
  await mock.start();
  const proj = await makeProject();
  console.log(`mock: ${mock.baseURL}\nproj: ${proj}\n`);

  await test('启动后显示 banner、模型名与输入框', async (home) => {
    mock.script([]);
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('voked');
    await s.waitFor('mock-fast');
    await s.waitFor('个工具就绪');
    // 输入框边框（NO_COLOR 下仍是 Unicode 字形，因为不是 legacy conhost 判定）
    await s.waitFor(/[╭+]/);
    s.type('/exit');
    assert.equal(await s.waitExit(), 0);
    assert.ok(!s.out.includes('?1049'), '不该进 alt-screen');
    assert.ok(!s.out.includes('\x1b[2J\x1b[3J') || s.out.includes('再见'), '不该无故整屏清除');
  });

  await test('普通对话：流式文本被提交成 markdown 正文', async (home) => {
    mock.turns = [{ text: '# 你好\n\n这是**回答**。\n\n- 一\n- 二\n' }];
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('讲个笑话');
    await s.waitFor('讲个笑话');
    await s.waitFor('这是回答');
    await s.waitFor(/[●•·*-]\s*一/);
    s.type('/exit');
    await s.waitExit();
  });

  await test('工具调用：显示调用行与结果摘要', async (home) => {
    mock.turns = [
      { tool: { name: 'Read', args: { filePath: path.join(proj, 'hello.txt') } } },
      { text: '文件读完了。' },
    ];
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('读一下 hello.txt');
    await s.waitFor('Read');
    await s.waitFor('voked E2E 标记行');
    await s.waitFor('文件读完了');
    await s.waitFor(/次工具/);
    s.type('/exit');
    await s.waitExit();
  });

  await test('思考内容完整显示（不折叠）', async (home) => {
    mock.turns = [{ reasoning: '我先想一想这个问题的边界条件', text: '答案是 42。' }];
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('思考题');
    await s.waitFor('我先想一想');
    await s.waitFor('答案是 42');
    // 不应再出现折叠成「思考 N 字」的行为
    s.type('/exit');
    await s.waitExit();
  });

  await test('/help 列出命令与快捷键', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('/help');
    await s.waitFor('/model');
    await s.waitFor('Alt+Enter');
    s.type('/exit');
    await s.waitExit();
  });

  await test('输入 / 弹出命令面板，Tab 补全', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.send('/mod');
    await s.waitFor('/model');
    s.send('\t'); // Tab 补全（model 不需要参数 → 补成 /model）
    await sleep(300);
    s.send('\r');
    await s.waitFor('选择模型');
    s.send(ESC);
    await sleep(200);
    s.type('/exit');
    await s.waitExit();
  });

  await test('模型选择器按供应商分组，可过滤可切换', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('/model');
    await s.waitFor('选择模型');
    await s.waitFor('Mock 供应商');
    await s.waitFor('另一个供应商');
    s.send('alt'); // 浮层自带过滤
    await sleep(300);
    s.send('\r');
    await s.waitFor('已切换模型：alt');
    await s.waitFor('alt-model');
    s.type('/exit');
    await s.waitExit();
  });

  await test('/model <关键词> 直接切换', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('/model smart');
    await s.waitFor('已切换模型：smart');
    s.type('/exit');
    await s.waitExit();
  });


  await test('!shell 直通执行', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('!echo E2E_SHELL_OK');
    await s.waitFor('E2E_SHELL_OK');
    s.type('/exit');
    await s.waitExit();
  });

  await test('Alt+Enter 换行，一次发送多行', async (home) => {
    mock.turns = [{ text: '收到多行。' }];
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.send('第一行');
    s.send(`${ESC}\r`); // Alt+Enter
    await sleep(150);
    s.send('第二行');
    await sleep(150);
    s.send('\r');
    await s.waitFor('收到多行');
    const req = mock.requests[mock.requests.length - 1] as { messages: Array<{ content: unknown }> };
    const last = JSON.stringify(req.messages);
    assert.ok(last.includes('第一行') && last.includes('第二行'), '多行内容没有一起发出去');
    s.type('/exit');
    await s.waitExit();
  });

  await test('运行中输入会排队，结束后自动依次发送', async (home) => {
    mock.turns = [{ text: '第一轮回答。' }, { text: '第二轮回答。' }];
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('问题一');
    // 不等第一轮结束就发第二条
    s.type('问题二');
    await s.waitFor('第一轮回答');
    await s.waitFor('第二轮回答');
    s.type('/exit');
    await s.waitExit();
  });

  await test('Esc 中断运行中的任务', async (home) => {
    // 让 mock 卡住不返回，保证有时间中断
    const slow = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"开始"}}]}\n\n');
      // 故意不结束
    });
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
    const port = (slow.address() as { port: number }).port;
    const slowHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voked-slow-'));
    await fs.mkdir(path.join(slowHome, '.voked'), { recursive: true });
    await fs.writeFile(
      path.join(slowHome, '.voked', 'config.json'),
      JSON.stringify({
        defaultModel: 'slow',
        models: { slow: { provider: 'openai-compatible', model: 'slow', apiKey: 'x', baseURL: `http://127.0.0.1:${port}/v1` } },
        permissionRules: [],
        mcpServers: [],
      }),
      'utf8'
    );

    const s = new CliSession(slowHome, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('慢慢来');
    await s.waitFor('开始');
    s.send(ESC);
    await s.waitFor(/已中断|已请求中断/);
    s.type('/exit');
    await s.waitExit();
    await new Promise<void>((r) => slow.close(() => r()));
  });

  await test('Ctrl+C 两次退出', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.send('\x03');
    await s.waitFor('再按一次');
    s.send('\x03');
    assert.equal(await s.waitExit(), 0);
  });

  await test('Ctrl+C 一次先清空输入而不是退出', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.send('一些没发出去的内容');
    await sleep(250);
    s.send('\x03');
    await sleep(250);
    assert.ok(s.exit === null, '不该退出');
    s.type('/exit');
    await s.waitExit();
  });

  await test('会话持久化：/new 后 /sessions 能看到', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('/new E2E 会话标题');
    await s.waitFor('已新建会话：E2E 会话标题');
    s.type('/sessions');
    await s.waitFor('E2E 会话标题');
    s.type('/exit');
    await s.waitExit();
  });

  await test('/status 与 /tools 输出关键信息', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('/status');
    await s.waitFor('模型');
    s.type('/tools');
    await s.waitFor('Read');
    await s.waitFor('Bash');
    s.type('/exit');
    await s.waitExit();
  });

  await test('/config show 不泄漏 API Key', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('/config show');
    await s.waitFor('defaultModel');
    assert.ok(!s.plain.includes('sk-test'), 'API Key 泄漏到了屏幕上');
    await s.waitFor('***');
    s.type('/exit');
    await s.waitExit();
  });

  await test('未知命令给出提示而不是崩溃', async (home) => {
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    s.type('/nosuchcmd');
    await s.waitFor('未知命令');
    s.type('/exit');
    await s.waitExit();
  });

  await test('粘贴大段文本不刷屏、内容完整', async (home) => {
    mock.turns = [{ text: '收到长文本。' }];
    const s = new CliSession(home, proj);
    s.start();
    await s.waitFor('个工具就绪');
    const big = '粘贴测试内容 '.repeat(80);
    s.send(`\x1b[200~${big}\x1b[201~`);
    await sleep(400);
    const beforeLen = s.out.length;
    s.send('\r');
    await s.waitFor('收到长文本');
    const req = mock.requests[mock.requests.length - 1] as { messages: Array<{ content: unknown }> };
    assert.ok(JSON.stringify(req.messages).includes('粘贴测试内容'), '粘贴内容没发出去');
    assert.ok(beforeLen < 400_000, `粘贴过程输出过多字节: ${beforeLen}`);
    s.type('/exit');
    await s.waitExit();
  });

  await test('没有模型配置时给出清晰错误并干净退出', async (home) => {
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'voked-empty-'));
    await fs.mkdir(path.join(emptyHome, '.voked'), { recursive: true });
    await fs.writeFile(
      path.join(emptyHome, '.voked', 'config.json'),
      JSON.stringify({ models: {}, permissionRules: [], mcpServers: [] }),
      'utf8'
    );
    const s = new CliSession(emptyHome, proj);
    s.start();
    await s.waitFor(/没有配置模型|--config/);
    assert.equal(await s.waitExit(), 0);
    assert.ok(s.out.trimEnd().endsWith('\x1b[?25h'), '退出时应恢复光标');
  });

  await test('--list / --config 非交互模式可用', async (home) => {
    const s = new CliSession(home, proj, ['--list']);
    s.start();
    assert.equal(await s.waitExit(), 0);
    assert.ok(s.plain.length > 0);

    const s2 = new CliSession(home, proj, ['--config']);
    s2.start();
    assert.equal(await s2.waitExit(), 0);
    await s2.waitFor('配置已存在');
  });

  await mock.stop();

  console.log('');
  if (failures.length) {
    console.error(`✗ ${failures.length} 个 E2E 用例失败：`);
    for (const f of failures) console.error(`\n--- ${f}`);
    process.exit(1);
  }
  console.log(`✓ E2E 全部通过（${passed} 个用例）`);
  process.exit(0);
}

void main();
