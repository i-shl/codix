/**
 * Grep - 文本搜索
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

export class GrepTool extends BaseTool<{
  pattern: string;
  path?: string;
  include?: string;
  exclude?: string;
  caseSensitive?: boolean;
  maxResults?: number;
  context?: number;
}> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'Grep',
    '使用 ripgrep 风格的文本搜索。可限定 path/include/exclude，返回 file:line:content。',
    {
      pattern: { type: 'string', description: '正则表达式' },
      path: { type: 'string', description: '搜索的起始路径（绝对路径，可指向本机任意目录，例如 C:\\Users\\用户名\\Desktop）；省略则使用工作目录 cwd' },
      include: { type: 'string', description: 'glob include 模式' },
      exclude: { type: 'string', description: 'glob exclude 模式' },
      caseSensitive: { type: 'boolean', default: true },
      maxResults: { type: 'integer', default: 200 },
      context: { type: 'integer', default: 0, description: '上下文行数' },
    },
    ['pattern']
  );

  renderUse(input: { pattern: string; path?: string }): string {
    return `Grep /${input.pattern}/${input.path ?? ''}`;
  }

  async execute(input: {
    pattern: string;
    path?: string;
    include?: string;
    exclude?: string;
    caseSensitive?: boolean;
    maxResults?: number;
    context?: number;
  }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    const root = input.path ?? ctx.cwd;
    const re = new RegExp(input.pattern, input.caseSensitive === false ? 'i' : '');
    const max = input.maxResults ?? 200;
    const ctxLines = input.context ?? 0;
    const includeRe = input.include ? globToRegex(input.include) : null;
    const excludeRe = input.exclude ? globToRegex(input.exclude) : null;

    const out: string[] = [];
    const visited = new Set<string>();
    const stat = await fs.stat(root).catch(() => null);
    if (!stat) return { toolCallId: '', content: `Error: 路径不存在 ${root}`, isError: true };

    const targets: string[] = [];
    if (stat.isFile()) targets.push(root);
    else await walk(root, targets, visited);

    outer: for (const file of targets) {
      if (includeRe && !includeRe.test(file)) continue;
      if (excludeRe && excludeRe.test(file)) continue;
      let st: import('node:fs').Stats;
      try { st = await fs.stat(file); } catch { continue; }
      if (!st.isFile() || st.size > MAX_FILE_SIZE) continue;
      let text: string;
      try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const start = Math.max(0, i - ctxLines);
          const end = Math.min(lines.length, i + ctxLines + 1);
          for (let j = start; j < end; j++) {
            out.push(`${path.relative(root, file)}:${j + 1}:${lines[j]}`);
            if (out.length >= max) break outer;
          }
        }
      }
    }
    if (out.length === 0) return { toolCallId: '', content: '(no matches)' };
    if (out.length >= max) out.push(`[truncated: max ${max} results]`);
    return { toolCallId: '', content: out.join('\n') };
  }
}

async function walk(dir: string, out: string[], visited: Set<string>): Promise<void> {
  const real = await fs.realpath(dir).catch(() => dir);
  if (visited.has(real)) return;
  visited.add(real);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.codix') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, visited);
    else out.push(p);
  }
}

function globToRegex(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + re + '$');
}