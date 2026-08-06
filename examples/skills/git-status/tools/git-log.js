/**
 * git_log 工具 - 显示 git 提交历史
 */
import { spawn } from 'node:child_process';

export const schema = {
  name: 'git_log',
  description: '显示 git 提交历史',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'integer', default: 10 } },
    required: [],
  },
};

export default {
  async execute(input, ctx) {
    return new Promise((resolve) => {
      const p = spawn('git', ['log', '--oneline', '-n', String(input.limit ?? 10)], {
        cwd: ctx.cwd,
        windowsHide: true,
      });
      let out = '';
      let err = '';
      p.stdout.on('data', (b) => (out += b.toString()));
      p.stderr.on('data', (b) => (err += b.toString()));
      p.on('close', (code) => {
        if (code !== 0) {
          resolve({ toolCallId: '', content: 'Error: ' + (err || 'git log 失败'), isError: true });
        } else {
          resolve({ toolCallId: '', content: out || '(无提交)' });
        }
      });
      p.on('error', (e) => resolve({ toolCallId: '', content: 'Error: ' + e.message, isError: true }));
    });
  },
  renderUse(input) {
    return `git log -n ${input.limit ?? 10}`;
  },
};