/**
 * 多行文本编辑器（输入框的数据模型）
 *
 * 只管「文本 + 光标」，不管渲染。渲染在 ui/composer.ts。
 *
 * 光标用「字符下标」而不是「码点下标」：
 * JS 字符串是 UTF-16，emoji 占 2 个 code unit。所有移动都按码点边界走，
 * 否则退格会把 emoji 劈成两个乱码。
 */
import { strWidth, wrapPlain } from './width.js';

export interface VisualPos {
  /** 视觉行号（换行 + 折行之后） */
  row: number;
  /** 该视觉行内的显示列 */
  col: number;
}

export class Editor {
  text = '';
  /** 光标在 text 中的下标（始终落在码点边界上） */
  cursor = 0;

  private history: string[] = [];
  private histIdx = -1; // -1 = 不在历史浏览中
  private histDraft = '';

  setHistory(items: string[]): void {
    this.history = items.slice();
    this.histIdx = -1;
  }

  pushHistory(text: string): void {
    const t = text.trim();
    if (!t) return;
    if (this.history[this.history.length - 1] === t) return;
    this.history.push(t);
    this.histIdx = -1;
  }

  clear(): void {
    this.text = '';
    this.cursor = 0;
    this.histIdx = -1;
  }

  setText(t: string, cursorToEnd = true): void {
    this.text = t;
    this.cursor = cursorToEnd ? t.length : Math.min(this.cursor, t.length);
  }

  get isEmpty(): boolean {
    return this.text.length === 0;
  }

  // ---------- 码点安全的步进 ----------

  private prevIndex(i: number): number {
    if (i <= 0) return 0;
    const before = this.text.slice(0, i);
    const chars = [...before];
    return i - (chars[chars.length - 1]?.length ?? 1);
  }

  private nextIndex(i: number): number {
    if (i >= this.text.length) return this.text.length;
    const cp = this.text.codePointAt(i);
    return i + (cp !== undefined && cp > 0xffff ? 2 : 1);
  }

  // ---------- 编辑 ----------

  insert(s: string): void {
    if (!s) return;
    this.text = this.text.slice(0, this.cursor) + s + this.text.slice(this.cursor);
    this.cursor += s.length;
    this.histIdx = -1;
  }

  backspace(): void {
    if (this.cursor === 0) return;
    const p = this.prevIndex(this.cursor);
    this.text = this.text.slice(0, p) + this.text.slice(this.cursor);
    this.cursor = p;
    this.histIdx = -1;
  }

  del(): void {
    if (this.cursor >= this.text.length) return;
    const n = this.nextIndex(this.cursor);
    this.text = this.text.slice(0, this.cursor) + this.text.slice(n);
    this.histIdx = -1;
  }

  /** Ctrl+W / Alt+Backspace */
  deleteWordBefore(): void {
    if (this.cursor === 0) return;
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.text[i - 1])) i--;
    while (i > 0 && !/\s/.test(this.text[i - 1])) i--;
    this.text = this.text.slice(0, i) + this.text.slice(this.cursor);
    this.cursor = i;
    this.histIdx = -1;
  }

  /** Ctrl+U：删到行首 */
  killToLineStart(): void {
    const ls = this.lineStart(this.cursor);
    this.text = this.text.slice(0, ls) + this.text.slice(this.cursor);
    this.cursor = ls;
    this.histIdx = -1;
  }

  /** Ctrl+K：删到行尾 */
  killToLineEnd(): void {
    const le = this.lineEnd(this.cursor);
    this.text = this.text.slice(0, this.cursor) + this.text.slice(le);
    this.histIdx = -1;
  }

  // ---------- 移动 ----------

  left(): void {
    this.cursor = this.prevIndex(this.cursor);
  }

  right(): void {
    this.cursor = this.nextIndex(this.cursor);
  }

  wordLeft(): void {
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.text[i - 1])) i--;
    while (i > 0 && !/\s/.test(this.text[i - 1])) i--;
    this.cursor = i;
  }

  wordRight(): void {
    let i = this.cursor;
    const n = this.text.length;
    while (i < n && /\s/.test(this.text[i])) i++;
    while (i < n && !/\s/.test(this.text[i])) i++;
    this.cursor = i;
  }

  private lineStart(i: number): number {
    const nl = this.text.lastIndexOf('\n', Math.max(0, i - 1));
    return nl === -1 ? 0 : nl + 1;
  }

  private lineEnd(i: number): number {
    const nl = this.text.indexOf('\n', i);
    return nl === -1 ? this.text.length : nl;
  }

  home(): void {
    this.cursor = this.lineStart(this.cursor);
  }

  end(): void {
    this.cursor = this.lineEnd(this.cursor);
  }

  /** 光标是否在整段文本的第一逻辑行 */
  get onFirstLine(): boolean {
    return this.lineStart(this.cursor) === 0;
  }

  /** 光标是否在整段文本的最后一逻辑行 */
  get onLastLine(): boolean {
    return this.lineEnd(this.cursor) === this.text.length;
  }

  /** 在逻辑行之间上下移动，保持列位置。返回是否移动成功 */
  up(): boolean {
    const ls = this.lineStart(this.cursor);
    if (ls === 0) return false;
    const col = this.cursor - ls;
    const prevStart = this.lineStart(ls - 1);
    const prevLen = ls - 1 - prevStart;
    this.cursor = prevStart + Math.min(col, prevLen);
    return true;
  }

  down(): boolean {
    const le = this.lineEnd(this.cursor);
    if (le === this.text.length) return false;
    const ls = this.lineStart(this.cursor);
    const col = this.cursor - ls;
    const nextStart = le + 1;
    const nextLen = this.lineEnd(nextStart) - nextStart;
    this.cursor = nextStart + Math.min(col, nextLen);
    return true;
  }

  // ---------- 历史 ----------

  /** 返回 true 表示消费了这次按键 */
  historyPrev(): boolean {
    if (this.history.length === 0) return false;
    if (this.histIdx === -1) {
      this.histDraft = this.text;
      this.histIdx = this.history.length - 1;
    } else if (this.histIdx > 0) {
      this.histIdx--;
    } else {
      return true; // 已经到顶，但仍然消费掉
    }
    const t = this.history[this.histIdx];
    this.text = t;
    this.cursor = t.length;
    return true;
  }

  historyNext(): boolean {
    if (this.histIdx === -1) return false;
    if (this.histIdx < this.history.length - 1) {
      this.histIdx++;
      const t = this.history[this.histIdx];
      this.text = t;
      this.cursor = t.length;
    } else {
      this.histIdx = -1;
      this.text = this.histDraft;
      this.cursor = this.histDraft.length;
    }
    return true;
  }

  // ---------- 视觉布局 ----------

  /**
   * 把文本按 width 折成视觉行，并算出光标落在哪一行哪一列。
   * 折行规则必须和渲染时一致，否则光标会飘。
   */
  layout(width: number): { lines: string[]; pos: VisualPos } {
    const w = Math.max(1, width);
    const lines: string[] = [];
    let pos: VisualPos = { row: 0, col: 0 };

    const logical = this.text.split('\n');
    let consumed = 0; // 已处理到 text 的哪个下标

    for (let li = 0; li < logical.length; li++) {
      const raw = logical[li];
      const segs = raw === '' ? [''] : wrapPlain(raw, w);
      let segOffset = 0;
      for (let si = 0; si < segs.length; si++) {
        const seg = segs[si];
        const start = consumed + segOffset;
        const end = start + seg.length;
        // 光标落在这一段里（末段用 <= 以便光标能停在行尾）
        const isLast = si === segs.length - 1 && li === logical.length - 1;
        if (
          this.cursor >= start &&
          (this.cursor < end || (this.cursor === end && (si === segs.length - 1 || isLast)))
        ) {
          pos = { row: lines.length, col: strWidth(this.text.slice(start, this.cursor)) };
        }
        lines.push(seg);
        segOffset += seg.length;
      }
      consumed += raw.length + 1; // +1 是 '\n'
    }

    if (lines.length === 0) lines.push('');
    return { lines, pos };
  }
}
