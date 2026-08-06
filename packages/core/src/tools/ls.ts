/**
 * LS - 列出目录
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';

export class LSTool extends BaseTool<{ dirPath: string; showHidden?: boolean; maxDepth?: number }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'LS',
    '列出目录内容。',
    {
      dirPath: { type: 'string', description: '要列出的目录（绝对路径，可指向本机任意目录，例如 C:\\Users\\用户名\\Desktop）；省略则使用工作目录 cwd' },
      showHidden: { type: 'boolean', default: false },
      maxDepth: { type: 'integer', default: 3 },
    },
    ['dirPath']
  );

  renderUse(input: { dirPath: string }): string {
    return `LS ${input.dirPath}`;
  }

  async execute(input: { dirPath: string; showHidden?: boolean; maxDepth?: number }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    const abs = path.isAbsolute(input.dirPath) ? input.dirPath : path.resolve(ctx.cwd, input.dirPath);
    const show = input.showHidden ?? false;
    const maxDepth = input.maxDepth ?? 3;
    const lines: string[] = [];
    await walk(abs, abs, 0, maxDepth, show, lines);
    if (!lines.length) return { toolCallId: '', content: '(empty)' };
    return { toolCallId: '', content: lines.join('\n') };
  }
}

async function walk(root: string, dir: string, depth: number, maxDepth: number, show: boolean, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const filtered = entries.filter((e) => show || !e.name.startsWith('.')).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const e of filtered) {
    const prefix = '  '.repeat(depth);
    const suffix = e.isDirectory() ? '/' : '';
    out.push(`${prefix}${e.name}${suffix}`);
    if (e.isDirectory() && depth + 1 < maxDepth) {
      await walk(root, path.join(dir, e.name), depth + 1, maxDepth, show, out);
    }
  }
}