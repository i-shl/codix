/**
 * 正文渲染：用户消息 / AI 回复 / 工具调用 / 系统提示
 *
 * 这里产出的行会被 Screen.writeBody 永久提交，所以只在「内容确定不再变」时调用。
 */
import type { ToolUse, ToolResult, ContentPart } from '../../../core/dist/index.js';
import { t as T } from '../../../core/dist/index.js';
import type { Theme } from '../tui/theme.js';
import { renderMarkdown } from '../tui/markdown.js';
import { wrapText } from '../tui/width.js';

function indent(lines: string[], pad: string): string[] {
  return lines.map((l) => pad + l);
}

export function renderBanner(t: Theme, info: { version: string; cwd: string; model: string }): string[] {
  const { c, g } = t;
  const title = c.bold(c.brand('codix'));
  return [
    '',
    ` ${title} ${c.muted(`v${info.version}`)}`,
    ` ${c.muted(`${g.dot} ${info.cwd}`)}`,
    ` ${c.muted(`${g.dot} ${T('banner.hint')}`)}`,
    '',
  ];
}

export function renderUser(text: string, t: Theme, width: number): string[] {
  const body = wrapText(text, Math.max(8, width - 2));
  return ['', ...body.map((l, i) => (i === 0 ? `${t.c.brand(t.g.caret)} ${t.c.bold(l)}` : `  ${l}`))];
}

export function renderAssistant(text: string, t: Theme, width: number): string[] {
  const md = renderMarkdown(text, t, Math.max(8, width - 2));
  if (md.length === 0) return [];
  return ['', `${t.c.green(t.g.bullet)} ${md[0]}`, ...indent(md.slice(1), '  ')];
}

export function renderThinking(text: string, t: Theme, width: number): string[] {
  const body = text.trim();
  if (!body) return [];
  const w = Math.max(8, width - 4);
  const out: string[] = ['', `  ${t.c.muted(`${t.g.ellipsisV} ${T('thinking.label')}`)}`];
  for (const raw of body.split('\n')) {
    for (const l of wrapText(raw, w)) out.push(`  ${t.c.muted(l)}`);
  }
  return out;
}

export function renderSystem(text: string, t: Theme, width: number): string[] {
  const body = wrapText(text, Math.max(8, width - 4));
  return ['', ...body.map((l) => `  ${t.c.muted(l)}`)];
}

export function renderError(text: string, t: Theme, width: number): string[] {
  const body = wrapText(text, Math.max(8, width - 4));
  return ['', ...body.map((l, i) => (i === 0 ? `  ${t.c.red(t.g.cross)} ${t.c.red(l)}` : `    ${t.c.red(l)}`))];
}

// ---------- 工具调用 ----------

/** 从工具入参里挑一个最能代表这次调用的字段做摘要 */
export function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  };
  const main =
    pick('filePath', 'dirPath', 'file_path', 'path', 'command', 'pattern', 'url', 'query', 'prompt', 'source', 'dir') ??
    (Object.keys(input).length ? JSON.stringify(input) : '');
  return main.replace(/\s+/g, ' ');
}

/** 完整展示工具调用的入参（不截断） */
export function renderToolStart(call: ToolUse, t: Theme, width: number): string[] {
  const head = `${t.c.yellow(t.g.bullet)} ${t.c.bold(call.name)}`;
  const out: string[] = ['', `  ${head}`];
  const inputStr = stringifyInput(call.input);
  if (inputStr) {
    const w = Math.max(8, width - 4);
    for (const raw of inputStr.split('\n')) {
      for (const l of wrapText(raw, w)) out.push(`  ${t.c.muted(l)}`);
    }
  }
  return out;
}

function stringifyInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input !== 'object') return String(input);
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function resultText(res: ToolResult): string {
  if (typeof res.content === 'string') return res.content;
  return (res.content as ContentPart[])
    .map((p) => (p.type === 'text' ? p.text : `[${p.type}]`))
    .join('\n');
}

/** 完整展示工具执行结果（不截断行数、按宽度换行） */
export function renderToolEnd(
  call: ToolUse,
  res: ToolResult,
  t: Theme,
  width: number,
  maxLines = Infinity
): string[] {
  const raw = resultText(res).replace(/\s+$/, '');
  const lines = raw ? raw.split('\n') : [];
  const color = res.isError ? t.c.red : t.c.muted;
  const branch = t.c.muted(t.g.branch);

  if (lines.length === 0) {
    return [`  ${branch} ${color(res.isError ? T('tool.failed') : T('tool.done'))}`];
  }

  const shown = maxLines === Infinity ? lines : lines.slice(0, maxLines);
  const out: string[] = [];
  const w = Math.max(8, width - 4);
  shown.forEach((l) => {
    for (const wl of wrapText(l, w)) {
      out.push(`  ${branch} ${color(wl)}`);
    }
  });
  if (maxLines !== Infinity && lines.length > maxLines) {
    out.push(`     ${t.c.muted(`… ${T('tool.moreLines', { n: lines.length - maxLines })}`)}`);
  }
  return out;
}

// ---------- 回合总结 ----------

export interface TurnStats {
  ms: number;
  input: number;
  output: number;
  tools: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function renderTurnSummary(s: TurnStats, t: Theme): string[] {
  const parts = [`${(s.ms / 1000).toFixed(1)}s`];
  if (s.input || s.output) parts.push(`↑${fmtTokens(s.input)} ↓${fmtTokens(s.output)}`);
  if (s.tools) parts.push(T('turn.tools', { n: s.tools }));
  return ['', `  ${t.c.muted(`${t.g.dot} ${parts.join(`  ${t.g.dot} `)}`)}`];
}
