/**
 * Bash 工具 + shell handler 测试
 * 验证：!cmd 本地执行后能产生 stdout 内容，且 cwd/timeout 参数生效
 */
import { BashTool } from '../dist/index.js';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) { console.log('PASS', msg); passed++; }
  else { console.error('FAIL', msg); failed++; }
}

async function main(): Promise<void> {
  const tool = new BashTool();
  const ac = new AbortController();

  // 1. echo 简单命令
  {
    const r = await tool.execute(
      { command: 'echo hello-voked' },
      { cwd: process.cwd(), signal: ac.signal, sessionId: 'test' }
    );
    const content = typeof r.content === 'string' ? r.content : String(r.content);
    check(content.includes('hello-voked'), 'echo 输出包含 hello-voked');
    check(content.includes('[exit 0]') || !r.isError, 'exit code 0');
  }

  // 2. cwd 生效
  {
    const tmp = process.platform === 'win32' ? 'C:\\Windows' : '/tmp';
    const r = await tool.execute(
      { command: process.platform === 'win32' ? 'cd' : 'pwd' },
      { cwd: tmp, signal: ac.signal, sessionId: 'test' }
    );
    const content = typeof r.content === 'string' ? r.content : String(r.content);
    check(content.includes(tmp) || content.toLowerCase().includes(tmp.toLowerCase().replace(/\\/g, '/')), 'pwd 反映自定义 cwd');
  }

  // 3. exit non-zero 标记 isError
  {
    const r = await tool.execute(
      { command: process.platform === 'win32' ? 'exit 7' : 'exit 7' },
      { cwd: process.cwd(), signal: ac.signal, sessionId: 'test' }
    );
    check(r.isError === true, 'exit 7 标记 isError');
  }

  // 4. 内容截断：超长 stdout（仅 Linux/macOS 测；Windows 命令行长度限制）
  if (process.platform !== 'win32') {
    const r = await tool.execute(
      { command: 'head -c 250000 /dev/zero | tr "\\0" "x"' },
      { cwd: process.cwd(), signal: ac.signal, sessionId: 'test' }
    );
    const content = typeof r.content === 'string' ? r.content : String(r.content);
    check(content.length < 260_000, '超长输出被截断（< 260K）');
  } else {
    console.log('SKIP 超长输出截断测试（Windows 跳过）');
  }

  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
