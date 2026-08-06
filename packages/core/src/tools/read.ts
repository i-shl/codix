/**
 * Read - 读取文件
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';

const MAX_BYTES = 200_000; // 200KB

export class ReadTool extends BaseTool<{ filePath: string; startLine?: number; endLine?: number }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'Read',
    '读取文件内容（支持行范围）。',
    {
      filePath: { type: 'string', description: '文件绝对路径（可指向本机任意目录，例如 C:\\Users\\用户名\\Desktop\\a.txt）；也可传相对于工作目录 cwd 的路径。无目录限制，整台电脑都能读。' },
      startLine: { type: 'integer', description: '起始行（从 0 开始）' },
      endLine: { type: 'integer', description: '结束行（不含）' },
    },
    ['filePath']
  );

  renderUse(input: { filePath: string; startLine?: number; endLine?: number }): string {
    return `Read ${input.filePath}${input.startLine !== undefined ? `:${input.startLine}` : ''}${input.endLine !== undefined ? `-${input.endLine}` : ''}`;
  }

  async execute(input: { filePath: string; startLine?: number; endLine?: number }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    const abs = path.isAbsolute(input.filePath) ? input.filePath : path.resolve(ctx.cwd, input.filePath);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) return { toolCallId: '', content: `Error: 文件不存在 ${abs}`, isError: true };
    if (stat.size > MAX_BYTES) {
      return { toolCallId: '', content: `Error: 文件过大 (${stat.size} bytes)，最大 ${MAX_BYTES} bytes。请使用 startLine/endLine 限定范围`, isError: true };
    }
    const text = await fs.readFile(abs, 'utf8');
    const lines = text.split(/\r?\n/);
    const start = input.startLine ?? 0;
    const end = input.endLine ?? lines.length;
    const sliced = lines.slice(start, end);
    const numbered = sliced.map((l, i) => `${(start + i).toString().padStart(5, ' ')} | ${l}`).join('\n');
    return { toolCallId: '', content: `\`\`\`\n${numbered}\n\`\`\`` };
  }
}