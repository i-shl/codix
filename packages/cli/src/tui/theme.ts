/**
 * 主题：字形 + 调色板
 *
 * legacy conhost 装不下 Unicode 框线和 emoji，会显示成方块或吃掉半个格子。
 * 所以每个字形都有 ASCII 退化版本，由 caps.unicode 决定用哪套。
 */
import { makePalette, type Palette, type TermCaps } from './ansi.js';
import { thinkingVerb } from '../../../core/dist/index.js';

export interface Glyphs {
  boxTL: string; boxTR: string; boxBL: string; boxBR: string;
  boxH: string; boxV: string;
  bullet: string;
  arrow: string;
  check: string;
  cross: string;
  dot: string;
  branch: string;
  ellipsisV: string;
  caret: string;
  spinner: string[];
}

const UNICODE: Glyphs = {
  boxTL: '╭', boxTR: '╮', boxBL: '╰', boxBR: '╯',
  boxH: '─', boxV: '│',
  bullet: '●',
  arrow: '›',
  check: '✓',
  cross: '✗',
  dot: '·',
  branch: '⎿',
  ellipsisV: '⋮',
  caret: '❯',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

const ASCII: Glyphs = {
  boxTL: '+', boxTR: '+', boxBL: '+', boxBR: '+',
  boxH: '-', boxV: '|',
  bullet: '*',
  arrow: '>',
  check: 'v',
  cross: 'x',
  dot: '-',
  branch: 'L',
  ellipsisV: ':',
  caret: '>',
  spinner: ['|', '/', '-', '\\'],
};

export interface Theme {
  g: Glyphs;
  c: Palette;
  caps: TermCaps;
}

export function makeTheme(caps: TermCaps): Theme {
  return { g: caps.unicode ? UNICODE : ASCII, c: makePalette(caps), caps };
}

/** 转圈时轮换的动词，避免长任务时界面像死了一样（随界面语言切换） */
export function pickVerb(): string {
  return thinkingVerb();
}
