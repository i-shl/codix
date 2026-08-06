/**
 * 全局规则加载
 *
 * 加载顺序（后置覆盖前者）：
 *   1. ~/.codix/rules.md       (全局)
 *   2. <project>/.codix/rules.md  (项目级)
 *   3. <project>/CODIX.md      (项目级，类 CLAUDE.md)
 *   4. <project>/AGENTS.md         (项目级)
 *
 * 规则会被注入到 system prompt。
 */
import path from 'node:path';
import { CODIX_HOME, fileExists, readFileText } from './utils/fs.js';

export interface LoadedRules {
  sources: { path: string; content: string }[];
  combined: string;
}

export async function loadRules(cwd: string): Promise<LoadedRules> {
  const candidates: string[] = [
    path.join(CODIX_HOME, 'rules.md'),
    path.join(cwd, '.codix', 'rules.md'),
    path.join(cwd, 'CODIX.md'),
    path.join(cwd, 'AGENTS.md'),
  ];
  const sources: { path: string; content: string }[] = [];
  for (const p of candidates) {
    if (await fileExists(p)) {
      try {
        const content = await readFileText(p);
        if (content.trim()) sources.push({ path: p, content });
      } catch {
        // ignore
      }
    }
  }
  const combined = sources.map((s) => `# Rules from ${s.path}\n\n${s.content}`).join('\n\n---\n\n');
  return { sources, combined };
}

export function buildSystemPrompt(parts: { identity?: string; rules?: string; tools?: string; skills?: string; extra?: string[] }): string {
  const sections: string[] = [];
  if (parts.identity) sections.push(parts.identity);
  if (parts.tools) sections.push(`# Available Tools\n${parts.tools}`);
  if (parts.skills) sections.push(`# Active Skills\n${parts.skills}`);
  if (parts.rules) sections.push(`# Rules\n${parts.rules}`);
  if (parts.extra && parts.extra.length) sections.push(parts.extra.join('\n\n'));
  return sections.join('\n\n');
}