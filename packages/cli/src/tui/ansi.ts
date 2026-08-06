/**
 * ANSI 转义序列 + 终端能力探测
 *
 * 设计约束（Windows 兼容性优先，见 README「终端渲染」一节）：
 *  - 永远不进入 alt-screen：CLI 输出必须留在滚动缓冲里，可以往上翻、可以复制
 *  - 只用 `CSI K`（擦到行尾）擦除，绝不用 `CSI 2J`（legacy conhost 会闪、会丢滚动历史）
 *  - 同步输出（DECSET 2026）在 legacy conhost 上会被当成可见文本，必须能关
 *  - 每帧无条件隐藏硬件光标，光标用反色单元格自己画（conhost 的光标定位不可靠）
 */
import process from 'node:process';

const ESC = '\x1b';
const CSI = `${ESC}[`;

export const seq = {
  /** 上移 n 行（n<=0 返回空串，避免发出 `CSI 0A` 这种在某些终端等价于 1 的序列） */
  up: (n = 1): string => (n > 0 ? `${CSI}${n}A` : ''),
  down: (n = 1): string => (n > 0 ? `${CSI}${n}B` : ''),
  /** 回到行首。用 \r 而不是 `CSI G`，conhost 更可靠 */
  col0: '\r',
  /** 擦除光标到行尾 */
  eraseToEol: `${CSI}K`,
  /** 擦除光标到屏幕底部 */
  eraseToEnd: `${CSI}J`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  /** DECSET 2026 同步输出：把一帧包起来，避免撕裂 */
  syncBegin: `${CSI}?2026h`,
  syncEnd: `${CSI}?2026l`,
  bracketedPasteOn: `${CSI}?2004h`,
  bracketedPasteOff: `${CSI}?2004l`,
  /** 仅 /clear 使用：清屏 + 归位 + 清滚动缓冲 */
  hardClear: `${CSI}2J${CSI}3J${CSI}H`,
  reset: `${ESC}c`,
};

// ============ 能力探测 ============

export interface TermCaps {
  isTTY: boolean;
  /** 0=无色 16=基础 256=256色 16777216=truecolor */
  color: 0 | 16 | 256 | 16777216;
  /** 能不能安全输出非 ASCII 框线/图标 */
  unicode: boolean;
  /** 支持 DECSET 2026 同步输出 */
  sync: boolean;
  /** 是否是 Windows 老式 conhost（不是 Windows Terminal / ConEmu / VSCode） */
  legacyConhost: boolean;
}

function envFlag(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  return v !== '0' && v.toLowerCase() !== 'false' && v.toLowerCase() !== 'no';
}

function detectModernWindowsTerminal(): boolean {
  const e = process.env;
  return !!(
    e.WT_SESSION ||
    e.WT_PROFILE_ID ||
    e.ConEmuANSI === 'ON' ||
    e.ALACRITTY_WINDOW_ID ||
    e.TERM_PROGRAM || // vscode / Hyper / Tabby …
    e.TERMINAL_EMULATOR ||
    e.MSYSTEM || // Git Bash / MSYS2 走 mintty
    e.WEZTERM_EXECUTABLE
  );
}

export function detectCaps(stream: NodeJS.WriteStream = process.stdout): TermCaps {
  const forced = envFlag('voked_FORCE_TTY');
  const isTTY = forced ?? !!stream.isTTY;

  const isWin = process.platform === 'win32';
  const modernWin = detectModernWindowsTerminal();
  const legacyConhost = isWin && !modernWin;

  const term = process.env.TERM ?? '';
  const colorterm = process.env.COLORTERM ?? '';

  // NO_COLOR 规范
  let color: TermCaps['color'];
  if (process.env.NO_COLOR !== undefined) {
    color = 0;
  } else if (!isTTY) {
    color = 0;
  } else if (colorterm === 'truecolor' || colorterm === '24bit') {
    color = 16777216;
  } else if (term.includes('256')) {
    color = 256;
  } else if (legacyConhost) {
    // conhost 从 Win10 1511 起支持 VT，但只保证 16 色稳定
    color = 16;
  } else if (isWin) {
    color = 16777216;
  } else if (term === 'dumb' || term === '') {
    // 注意：Windows 下 TERM 常常是空的或 dumb，但 VT 其实可用 —— 不能据此禁用
    color = isWin ? 16 : 0;
  } else {
    color = 256;
  }

  const forceColor = envFlag('FORCE_COLOR');
  if (forceColor === false) color = 0;
  else if (forceColor === true && color === 0) color = 16;

  const unicode =
    envFlag('voked_UNICODE') ??
    (!legacyConhost && process.env.LANG !== 'C' && process.env.LC_ALL !== 'C');

  const sync = envFlag('voked_SYNC') ?? (isTTY && !legacyConhost);

  return { isTTY, color, unicode, sync, legacyConhost };
}

// ============ 颜色 ============

export type Painter = (s: string) => string;

function sgr(open: string, close = '39'): Painter {
  return (s) => `${CSI}${open}m${s}${CSI}${close}m`;
}

const identity: Painter = (s) => s;

export interface Palette {
  reset: Painter;
  bold: Painter;
  dim: Painter;
  italic: Painter;
  underline: Painter;
  inverse: Painter;
  strike: Painter;

  red: Painter;
  green: Painter;
  yellow: Painter;
  blue: Painter;
  magenta: Painter;
  cyan: Painter;
  gray: Painter;
  white: Painter;

  /** 品牌主色 */
  brand: Painter;
  /** 次要信息 */
  muted: Painter;
  /** 代码块背景 */
  codeBg: Painter;
}

export function makePalette(caps: TermCaps): Palette {
  if (caps.color === 0) {
    const n = identity;
    return {
      reset: n, bold: n, dim: n, italic: n, underline: n, inverse: n, strike: n,
      red: n, green: n, yellow: n, blue: n, magenta: n, cyan: n, gray: n, white: n,
      brand: n, muted: n, codeBg: n,
    };
  }

  const rich = caps.color >= 256;
  const fg256 = (n: number): Painter => sgr(`38;5;${n}`);

  return {
    reset: (s) => `${CSI}0m${s}`,
    bold: sgr('1', '22'),
    // conhost 的 dim(2) 支持不稳，退化成灰色
    dim: caps.legacyConhost ? sgr('90') : sgr('2', '22'),
    italic: caps.legacyConhost ? identity : sgr('3', '23'),
    underline: sgr('4', '24'),
    inverse: sgr('7', '27'),
    strike: caps.legacyConhost ? identity : sgr('9', '29'),

    red: sgr('31'),
    green: sgr('32'),
    yellow: sgr('33'),
    blue: sgr('34'),
    magenta: sgr('35'),
    cyan: sgr('36'),
    gray: sgr('90'),
    white: sgr('97'),

    brand: rich ? fg256(75) : sgr('36'),
    muted: rich ? fg256(245) : sgr('90'),
    codeBg: rich ? fg256(180) : sgr('33'),
  };
}

/** 去掉字符串里的所有 SGR / CSI 序列，用于算宽度 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}
