/**
 * Edit - 编辑文件（基于 find/replace）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';

export class EditTool extends BaseTool<{ filePath: string; oldText: string; newText: string; replaceAll?: boolean }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'Edit',
    '基于 oldText/newText 替换编辑文件。如果有多个匹配，默认只替换第一个；设置 replaceAll=true 替换全部。',
    {
      filePath: { type: 'string' },
      oldText: { type: 'string', description: '要替换的原文本' },
      newText: { type: 'string', description: '替换为的新文本' },
      replaceAll: { type: 'boolean', default: false },
    },
    ['filePath', 'oldText', 'newText']
  );

  renderUse(input: { filePath: string; oldText: string; newText: string }): string {
    return `Edit ${input.filePath}: ${truncate(input.oldText, 60)} → ${truncate(input.newText, 60)}`;
  }

  async execute(input: { filePath: string; oldText: string; newText: string; replaceAll?: boolean }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    const abs = path.isAbsolute(input.filePath) ? input.filePath : path.resolve(ctx.cwd, input.filePath);
    const exists = await fs.access(abs).then(() => true).catch(() => false);
    if (!exists) return { toolCallId: '', content: `Error: 文件不存在 ${abs}`, isError: true };
    const original = await fs.readFile(abs, 'utf8');
    const occurrences = original.split(input.oldText).length - 1;
    if (occurrences === 0) {
      return { toolCallId: '', content: `Error: 没有找到 oldText。请检查空白、引号、换行是否匹配。`, isError: true };
    }
    if (occurrences > 1 && !input.replaceAll) {
      return {
        toolCallId: '',
        content: `Error: 找到 ${occurrences} 处匹配。请使用更精确的 oldText，或设置 replaceAll=true`,
        isError: true,
      };
    }
    const updated = input.replaceAll ? original.replaceAll(input.oldText, input.newText) : original.replace(input.oldText, input.newText);
    await fs.writeFile(abs, updated, 'utf8');
    return { toolCallId: '', content: `Edited ${abs}: 1 replacement` };
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 3) + '...';
}