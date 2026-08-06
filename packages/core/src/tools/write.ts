/**
 * Write - 写入文件
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';
import { writeFileAtomic } from '../utils/fs.js';

export class WriteTool extends BaseTool<{ filePath: string; content: string }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'Write',
    '写入文件（会覆盖原文件）。',
    {
      filePath: { type: 'string', description: '要写入的文件绝对路径（可指向本机任意目录，例如 C:\\Users\\用户名\\Desktop\\a.txt）；也可传相对于 cwd 的路径。无目录限制。' },
      content: { type: 'string' },
    },
    ['filePath', 'content']
  );

  renderUse(input: { filePath: string; content: string }): string {
    return `Write ${input.filePath} (${input.content.length} chars)`;
  }

  async execute(input: { filePath: string; content: string }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    const abs = path.isAbsolute(input.filePath) ? input.filePath : path.resolve(ctx.cwd, input.filePath);
    const existed = await fs.access(abs).then(() => true).catch(() => false);
    await writeFileAtomic(abs, input.content);
    return { toolCallId: '', content: `Wrote ${input.content.length} bytes to ${abs} (${existed ? 'overwritten' : 'created'})` };
  }
}