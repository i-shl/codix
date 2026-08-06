/**
 * 端到端测试：发送带附件文件的消息，验证 AI 能读取附件内容
 */
import { createAgentContext, runAgent } from '../dist/index.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const cwd = 'D:\\other\\voked';
const ctx = await createAgentContext(cwd);
const session = await ctx.sessions.create({ cwd, title: 'attachment-e2e' });
const fileData = Buffer.from('voked attachment test: 42 is the answer').toString('base64');

const handle = runAgent(
  ctx,
  session.id,
  {
    text: '请读取我发送的附件文件，告诉我文件内容里包含哪个数字，以及文件的绝对路径。',
    files: [{ fileName: 'test-attach.txt', mediaType: 'text/plain', data: fileData }],
  },
  {
    onPermissionAsk: async () => 'allow',
  }
);

const result = await handle.promise;
for (const m of result.messages) {
  const content = typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
  console.log(`--- ${m.role} ${m.toolCalls ? '[tools]' : ''}`);
  console.log(content.slice(0, 400));
}

// 检查落盘文件
const dir = path.join(os.tmpdir(), 'voked-attachments', session.id);
console.log('=== 附件目录 ===');
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir)) {
    console.log(f, '->', fs.readFileSync(path.join(dir, f), 'utf8'));
  }
} else {
  console.log('(不存在)');
}
process.exit(0);
