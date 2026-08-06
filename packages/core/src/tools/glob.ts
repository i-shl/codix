/**
 * Glob - 文件匹配
 */
import path from 'node:path';
import fg from 'fast-glob';
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';

export class GlobTool extends BaseTool<{ pattern: string; cwd?: string; ignore?: string[] }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'Glob',
    '使用 glob 模式匹配文件。返回相对路径列表。',
    {
      pattern: { type: 'string', description: 'glob 模式，例如 "**/*.ts"' },
      cwd: { type: 'string' },
      ignore: { type: 'array', items: { type: 'string' } },
    },
    ['pattern']
  );

  renderUse(input: { pattern: string }): string {
    return `Glob ${input.pattern}`;
  }

  async execute(input: { pattern: string; cwd?: string; ignore?: string[] }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    const cwd = input.cwd ?? ctx.cwd;
    const files = await fg(input.pattern, {
      cwd,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.voked/**',
        ...(input.ignore ?? []),
      ],
      dot: false,
      onlyFiles: true,
    });
    const sorted = files.sort().slice(0, 1000);
    const out = sorted.length === 0 ? '(no matches)' : sorted.join('\n');
    return { toolCallId: '', content: out };
  }
}