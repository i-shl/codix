/**
 * 终端显示宽度计算（CJK / emoji 感知）+ 换行 / 截断
 *
 * 终端按「单元格」排版，一个 CJK 字符占 2 格、组合符号占 0 格。
 * 算错宽度 = 底部 footer 行数算错 = 光标上移行数算错 = 界面错位，
 * 所以这里必须比 `str.length` 认真。
 */
import { stripAnsi } from './ansi.js';

/** East Asian Wide / Fullwidth 区间（来自 Unicode EastAsianWidth.txt，取主要块） */
const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals, Kangxi, CJK Symbols
  [0x3041, 0x33ff], // Hiragana … CJK Compatibility
  [0x3400, 0x4dbf], // CJK Ext A
  [0x4e00, 0x9fff], // CJK Unified
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Ext-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6],
  [0x1b000, 0x1b001],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f320],
  [0x1f330, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f380, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f400, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f500, 0x1f53d],
  [0x1f550, 0x1f567],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

/** 零宽：组合符号 / 变体选择符 / 零宽连接符 */
const ZERO_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x200b, 0x200f], // ZWSP / ZWNJ / ZWJ / LRM / RLM
  [0x20d0, 0x20f0],
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef],
];

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** 单个码点的显示宽度 */
export function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // 控制字符
  if (inRanges(cp, ZERO_RANGES)) return 0;
  if (inRanges(cp, WIDE_RANGES)) return 2;
  return 1;
}

/** 字符串显示宽度（会先剥掉 ANSI 序列） */
export function strWidth(s: string): number {
  const plain = stripAnsi(s);
  let w = 0;
  for (const ch of plain) w += charWidth(ch.codePointAt(0) ?? 0);
  return w;
}

/** 用空格把字符串补到指定显示宽度 */
export function padEnd(s: string, width: number): string {
  const d = width - strWidth(s);
  return d > 0 ? s + ' '.repeat(d) : s;
}

export function padStart(s: string, width: number): string {
  const d = width - strWidth(s);
  return d > 0 ? ' '.repeat(d) + s : s;
}

export function padCenter(s: string, width: number): string {
  const d = width - strWidth(s);
  if (d <= 0) return s;
  const left = Math.floor(d / 2);
  return ' '.repeat(left) + s + ' '.repeat(d - left);
}

/**
 * 按显示宽度截断（保留 ANSI 序列不被切断）。
 * 超长时追加 ellipsis（默认 `…`，其宽度计入 max）。
 */
export function truncate(s: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return '';
  if (strWidth(s) <= max) return s;
  const ellW = strWidth(ellipsis);
  const budget = Math.max(0, max - ellW);

  let out = '';
  let w = 0;
  let i = 0;
  while (i < s.length) {
    // 原样拷贝 ANSI 序列
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;?]*[ -/]*[@-~]|^\x1b[@-Z\\-_]/.exec(s.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const cp = s.codePointAt(i);
    if (cp === undefined) break;
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out + ellipsis + '\x1b[0m';
}

/**
 * 硬换行：把一行按显示宽度切成多行。
 * - 优先在空格处断（软换行），单词超长时硬切
 * - CJK 之间可以任意断
 * - 保留 ANSI：每段结尾补 reset，下一段开头继承当前样式
 */
export function wrapLine(s: string, width: number): string[] {
  if (width <= 0) return [s];
  if (strWidth(s) <= width) return [s];

  const out: string[] = [];
  let cur = '';
  let curW = 0;
  let pendingStyle = '';
  /** 最近一次可断点在 cur 中的下标 & 宽度 */
  let breakAt = -1;
  let breakW = 0;

  let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;?]*[ -/]*[@-~]|^\x1b[@-Z\\-_]/.exec(s.slice(i));
      if (m) {
        cur += m[0];
        // 记住当前样式，换行后重新应用；`0m` 清空
        pendingStyle = m[0] === '\x1b[0m' ? '' : pendingStyle + m[0];
        i += m[0].length;
        continue;
      }
    }
    const cp = s.codePointAt(i);
    if (cp === undefined) break;
    const ch = String.fromCodePoint(cp);
    const cw = charWidth(cp);

    if (curW + cw > width) {
      if (breakAt > 0 && breakW > 0) {
        // 在最近的空格处断行
        out.push(cur.slice(0, breakAt).replace(/\s+$/, '') + '\x1b[0m');
        const rest = cur.slice(breakAt).replace(/^\s+/, '');
        cur = pendingStyle + rest;
        curW = strWidth(rest);
      } else {
        out.push(cur + '\x1b[0m');
        cur = pendingStyle;
        curW = 0;
      }
      breakAt = -1;
      breakW = 0;
    }

    cur += ch;
    curW += cw;
    i += ch.length;

    if (ch === ' ' || ch === '\t' || cw === 2) {
      breakAt = cur.length;
      breakW = curW;
    }
  }

  if (strWidth(cur) > 0 || out.length === 0) out.push(cur + (pendingStyle ? '\x1b[0m' : ''));
  return out;
}

/**
 * 纯文本折行：不插入任何 ANSI，且**保证各段拼接后等于原串**。
 * 输入框必须用它 —— 编辑器要靠段长度反推光标下标，
 * 用 wrapLine（会补 reset、会吃掉行尾空格）会让光标算飘。
 */
export function wrapPlain(s: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  let cur = '';
  let curW = 0;
  let lastBreak = -1; // cur 中最近一个空格之后的下标

  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0) ?? 0);
    if (curW + cw > w) {
      if (lastBreak > 0 && lastBreak < cur.length) {
        out.push(cur.slice(0, lastBreak));
        cur = cur.slice(lastBreak);
        curW = strWidth(cur);
      } else {
        out.push(cur);
        cur = '';
        curW = 0;
      }
      lastBreak = -1;
    }
    cur += ch;
    curW += cw;
    if (ch === ' ') lastBreak = cur.length;
  }
  out.push(cur);
  return out;
}

/** 对整段文本（含 \n）做换行 */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (raw === '') {
      out.push('');
      continue;
    }
    out.push(...wrapLine(raw, width));
  }
  return out;
}
