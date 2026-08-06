/**
 * Markdown → 终端 ANSI 行
 *
 * 复用 core 的 parseMarkdown（桌面端也用它，保证两端语义一致）。
 * 输出是「已经按宽度折好的行数组」，直接丢给 Screen.writeBody 即可。
 */
import { parseMarkdown, type Block, type Inline, type CellAlign } from '../../../core/dist/index.js';
import type { Theme } from './theme.js';
import { strWidth, wrapText, padEnd, padStart, padCenter, truncate } from './width.js';

function renderInline(nodes: Inline[], t: Theme): string {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out += n.text;
        break;
      case 'bold':
        out += t.c.bold(renderInline(n.children, t));
        break;
      case 'italic':
        out += t.c.italic(renderInline(n.children, t));
        break;
      case 'code':
        out += t.c.codeBg(n.text);
        break;
      case 'link':
        out += `${t.c.underline(n.text)} ${t.c.muted(`(${n.url})`)}`;
        break;
    }
  }
  return out;
}

function alignCell(s: string, w: number, a: CellAlign): string {
  const clipped = strWidth(s) > w ? truncate(s, w, '…') : s;
  if (a === 'right') return padStart(clipped, w);
  if (a === 'center') return padCenter(clipped, w);
  return padEnd(clipped, w);
}

function renderTable(b: Extract<Block, { kind: 'table' }>, t: Theme, width: number): string[] {
  const cols = Math.max(b.headers.length, ...b.rows.map((r) => r.length), 1);
  const headers = Array.from({ length: cols }, (_, i) => b.headers[i] ?? '');
  const rows = b.rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
  const align: CellAlign[] = Array.from({ length: cols }, (_, i) => b.align[i] ?? 'left');

  // 先按内容算理想宽度，再按终端宽度等比压缩
  const widths = headers.map((h, i) =>
    Math.max(strWidth(h), ...rows.map((r) => strWidth(r[i])), 1)
  );
  const frame = cols * 3 + 1; // '| ' + ' | ' … + ' |'
  let total = widths.reduce((a, b2) => a + b2, 0) + frame;
  while (total > width && Math.max(...widths) > 4) {
    const idx = widths.indexOf(Math.max(...widths));
    widths[idx] -= 1;
    total -= 1;
  }

  const { boxH } = t.g;
  const line = (cells: string[], pad: (s: string, w: number, a: CellAlign) => string): string =>
    `${t.c.muted('|')} ${cells.map((c, i) => pad(c, widths[i], align[i])).join(` ${t.c.muted('|')} `)} ${t.c.muted('|')}`;

  const sep = t.c.muted(`+${widths.map((w) => boxH.repeat(w + 2)).join('+')}+`);

  const out: string[] = [];
  out.push(sep);
  out.push(line(headers.map((h) => t.c.bold(h)), (s, w, a) => alignCell(s, w, a)));
  out.push(sep);
  for (const r of rows) out.push(line(r, (s, w, a) => alignCell(s, w, a)));
  out.push(sep);
  return out;
}

function renderBlock(b: Block, t: Theme, width: number): string[] {
  switch (b.kind) {
    case 'heading': {
      const text = renderInline(b.children, t);
      const styled =
        b.level === 1 ? t.c.bold(t.c.brand(text)) : b.level === 2 ? t.c.bold(text) : t.c.brand(text);
      const prefix = b.level === 1 ? '' : b.level === 2 ? '' : '';
      return wrapText(prefix + styled, width);
    }
    case 'paragraph':
      return wrapText(renderInline(b.children, t), width);
    case 'code-block': {
      const lang = b.lang ? t.c.muted(` ${b.lang}`) : '';
      const bar = t.c.muted(t.g.boxV);
      const head = t.c.muted(`${t.g.boxTL}${t.g.boxH.repeat(2)}`) + lang;
      const lines = b.text.replace(/\n$/, '').split('\n');
      const body = lines.flatMap((l) => {
        const chunks = wrapText(l, Math.max(4, width - 2));
        return chunks.map((c) => `${bar} ${t.c.codeBg(c)}`);
      });
      const foot = t.c.muted(`${t.g.boxBL}${t.g.boxH.repeat(2)}`);
      return [head, ...body, foot];
    }
    case 'blockquote': {
      const bar = t.c.muted(t.g.boxV);
      return wrapText(renderInline(b.children, t), Math.max(4, width - 2)).map(
        (l) => `${bar} ${t.c.muted(l)}`
      );
    }
    case 'list': {
      const out: string[] = [];
      b.items.forEach((item, i) => {
        const marker = b.ordered ? `${i + 1}.` : t.g.bullet;
        const indent = ' '.repeat(strWidth(marker) + 1);
        const lines = wrapText(renderInline(item, t), Math.max(4, width - strWidth(marker) - 1));
        lines.forEach((l, j) => {
          out.push(j === 0 ? `${t.c.brand(marker)} ${l}` : `${indent}${l}`);
        });
      });
      return out;
    }
    case 'table':
      return renderTable(b, t, width);
    case 'hr':
      return [t.c.muted(t.g.boxH.repeat(Math.max(4, Math.min(width, 60))))];
    default:
      return [];
  }
}

/** 把一段 markdown 渲染成终端行（块之间留空行） */
export function renderMarkdown(src: string, t: Theme, width: number): string[] {
  if (!src.trim()) return [];
  let blocks: Block[];
  try {
    blocks = parseMarkdown(src);
  } catch {
    return wrapText(src, width);
  }
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) out.push('');
    out.push(...renderBlock(b, t, width));
  });
  return out;
}
