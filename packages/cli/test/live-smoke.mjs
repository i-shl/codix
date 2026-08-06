/**
 * 真机冒烟：用当前用户的真实模型配置跑一轮「读文件」，验证流式 tool_calls 在真服务上确实能落地。
 * 需要 ~/.voked/config.json 里有可用模型 + 网络，因此不进 pnpm test，手动跑：
 *   node packages/cli/test/live-smoke.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '..', 'dist', 'index.js');
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;

const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'voked-live-'));
await fs.writeFile(path.join(proj, 'secret.txt'), 'LIVE_SMOKE_TOKEN_9f3a\n', 'utf8');

const proc = spawn(process.execPath, [ENTRY], {
  cwd: proj,
  env: { ...process.env, voked_FORCE_TTY: '1', NO_COLOR: '1', COLUMNS: '100' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let out = '';
proc.stdout.setEncoding('utf8');
proc.stdout.on('data', (d) => (out += d));
proc.stderr.setEncoding('utf8');
proc.stderr.on('data', (d) => (out += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = () => out.replace(ANSI, '');

async function waitFor(re, ms) {
  const t = Date.now();
  while (!re.test(plain())) {
    if (Date.now() - t > ms) throw new Error(`超时等待 ${re}\n${plain().slice(-3000)}`);
    await sleep(200);
  }
}

try {
  await waitFor(/个工具就绪/, 60000);
  proc.stdin.write('用 Read 工具读取 secret.txt，把里面的内容原样告诉我\r');
  await waitFor(/Read/, 90000);
  await waitFor(/LIVE_SMOKE_TOKEN_9f3a/, 90000);
  await waitFor(/次工具/, 90000);
  console.log('✓ 真机冒烟通过：模型发起了 Read 调用，工具执行成功并回显了内容');
  proc.stdin.write('/exit\r');
  await sleep(1000);
} catch (e) {
  console.error('✗ 真机冒烟失败：', e.message);
  process.exitCode = 1;
} finally {
  if (proc.exitCode === null) proc.kill();
}
