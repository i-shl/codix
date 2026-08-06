/**
 * 极简 markdown 解析器
 *
 * 支持：
 *   - # / ## / ### 标题
 *   - ``` 围栏代码块
 *   - **bold** / *italic* / `code` 内联
 *   - [text](url) 链接
 *   - > 引用
 *   - - / * 无序列表
 *   - 1. 有序列表
 *   - | 表头 | 表头 | 表格
 *   - |---|---| 分隔线（支持 :--- / :---: / ---: 对齐）
 *   - --- 分隔线
 *
 * 不解析 HTML 标签（防止 XSS），所有特殊字符已转义。
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string };

export type CellAlign = 'left' | 'center' | 'right';

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'code-block'; lang?: string; text: string }
  | { kind: 'blockquote'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; headers: string[]; rows: string[][]; align: CellAlign[] }
  | { kind: 'hr' };

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 围栏代码块
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 跳过收尾 ```
      blocks.push({ kind: 'code-block', lang, text: codeLines.join('\n') });
      continue;
    }

    // 分隔线
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, children: parseInline(h[2]) });
      i++;
      continue;
    }

    // 引用（可能多行）
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const inner = parseMarkdown(quoteLines.join('\n'));
      // 折叠成单段落
      const inline = inner.flatMap((b): Inline[] => {
        if (b.kind === 'paragraph') return b.children;
        if (b.kind === 'heading') return b.children;
        return [{ kind: 'text' as const, text: '' }];
      });
      blocks.push({ kind: 'blockquote', children: inline });
      continue;
    }

    // 列表
    const ulItem = line.match(/^[-*]\s+(.+)$/);
    const olItem = line.match(/^\d+\.\s+(.+)$/);
    if (ulItem || olItem) {
      const ordered = !!olItem;
      const items: Inline[][] = [];
      const re = ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/;
      while (i < lines.length && re.test(lines[i])) {
        const m = lines[i].match(re);
        if (m) items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // 表格：header | 分隔行(:---/:---:/---:) | data rows
    // 分隔行：| --- | :---: | ---: | ... 至少 1 个 --- 且必须只有 - : 和空格
    if (
      i + 1 < lines.length &&
      isTableLine(line) &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      const align = parseTableAlign(lines[i + 1]);
      // 列数以分隔行为准（作者有时写 | A | B 有时写 A | B，分隔行通常更规整）
      const colCount = align.length;
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableLine(lines[i])) {
        const r = splitTableRow(lines[i]);
        // 补齐 / 截断
        while (r.length < colCount) r.push('');
        if (r.length > colCount) r.length = colCount;
        rows.push(r);
        i++;
      }
      // header 也对齐到 colCount
      while (headers.length < colCount) headers.push('');
      if (headers.length > colCount) headers.length = colCount;
      // align 与 columns 已对齐
      if (colCount > 0) {
        blocks.push({ kind: 'table', headers, rows, align });
        continue;
      }
    }

    // 段落（连续非空行）
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|```|>|[-*]\s|\d+\.\s|---+\s)/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paraLines.join(' ')) });
  }

  return blocks;
}

/** 是否像一行表格（含至少一个 | 且两端不是 |---... 分隔） */
function isTableLine(line: string): boolean {
  if (!line.trim().startsWith('|')) return false;
  // 不能是分隔线（全是 - : 空格）
  return !/^\|?[\s:-]+$/.test(line.trim());
}

/** 是否像表格分隔行：| --- | :---: | ---: | ...（每格只含 - : 和空格，且至少一格） */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith('|') && !t.includes('|')) return false;
  // 每段必须是 :--- : / --- / :--- 的形式（允许两端冒号）
  // 形如：可选 | + (空格 + 可选: + -+ + 可选: + 空格 + |)+ + 可选空格 + 可选 |
  return /^\|?(\s*:?-+:?\s*\|)+\s*\|?$/.test(t);
}

/** 切分表格行：先按 | 切分 trim，丢掉首尾的空 cell（处理首尾 | 的可选性） */
function splitTableRow(line: string): string[] {
  const cells = line.split('|').map((c) => c.trim());
  while (cells.length && cells[0] === '') cells.shift();
  while (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** 从分隔行解析对齐方式 */
function parseTableAlign(line: string): CellAlign[] {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

/** 解析内联 markdown（bold/italic/code/link），不跨行 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = '';

  const flush = (): void => {
    if (buf) {
      out.push({ kind: 'text', text: buf });
      buf = '';
    }
  };

  while (i < src.length) {
    // 行内代码（最高优先级，含 `**` 等都不解析）
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // 链接 [text](url)
    if (src[i] === '[') {
      const close = src.indexOf(']', i + 1);
      if (close > i && src[close + 1] === '(') {
        const urlEnd = src.indexOf(')', close + 2);
        if (urlEnd > close + 1) {
          flush();
          out.push({ kind: 'link', text: src.slice(i + 1, close), url: src.slice(close + 2, urlEnd) });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    // 粗体 **text**
    if (src[i] === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'bold', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    // 斜体 *text*（避免吞掉粗体的 **）
    if (src[i] === '*' && src[i + 1] !== '*' && src[i - 1] !== '*') {
      const end = src.indexOf('*', i + 1);
      if (end > i && src[end + 1] !== '*') {
        flush();
        out.push({ kind: 'italic', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    // 斜体 _text_
    if (src[i] === '_' && src[i + 1] !== '_' && (i === 0 || /\W/.test(src[i - 1])) && (i + 1 < src.length)) {
      const end = src.indexOf('_', i + 1);
      if (end > i && (end + 1 >= src.length || /\W/.test(src[end + 1]))) {
        flush();
        out.push({ kind: 'italic', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}
