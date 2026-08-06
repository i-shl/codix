/**
 * 输入框 + 状态行渲染
 *
 * 输出「footer 行数组 + 光标位置」，由 Screen 负责真正落地。
 */
import type { Theme } from '../tui/theme.js';
import type { Editor } from '../tui/editor.js';
import type { ScreenCursor } from '../tui/screen.js';
import { strWidth, padEnd, truncate } from '../tui/width.js';

export interface ComposerProps {
  editor: Editor;
  theme: Theme;
  /** footer 可用宽度 */
  width: number;
  placeholder: string;
  /** 输入框上方的额外行（浮层 / 流式预览 / 状态行） */
  above: string[];
  /** 输入框下方的提示行 */
  hint: string;
  /** 左下角状态（cwd · 模式 · 模型） */
  status: string;
  /** true 时输入框变灰（运行中仍可打字，回车排队） */
  dimmed: boolean;
  /** 光标是否交给输入框（浮层激活时为 false） */
  focused: boolean;
  /** 多行模式标记 */
  multiline: boolean;
}

export interface ComposerFrame {
  lines: string[];
  cursor: ScreenCursor | null;
}

const PROMPT_W = 2;

export function renderComposer(p: ComposerProps): ComposerFrame {
  const { theme: t, editor, width } = p;
  const boxW = Math.max(24, width);
  const textW = Math.max(8, boxW - 2 /* 边框 */ - 2 /* 内边距 */ - PROMPT_W);

  const { lines: textLines, pos } = editor.layout(textW);
  const showPlaceholder = editor.isEmpty && p.placeholder;

  const border = p.dimmed ? t.c.muted : t.c.brand;
  const top = border(t.g.boxTL + t.g.boxH.repeat(boxW - 2) + t.g.boxTR);
  const bottom = border(t.g.boxBL + t.g.boxH.repeat(boxW - 2) + t.g.boxBR);
  const v = border(t.g.boxV);

  const body: string[] = [];
  const rendered = showPlaceholder ? [''] : textLines;
  rendered.forEach((line, i) => {
    const prompt =
      i === 0
        ? (p.dimmed ? t.c.muted(t.g.caret) : t.c.brand(t.g.caret)) + ' '
        : '  ';
    const content =
      showPlaceholder && i === 0
        ? t.c.muted(truncate(p.placeholder, textW))
        : p.dimmed
          ? t.c.muted(line)
          : line;
    const pad = ' '.repeat(Math.max(0, textW - strWidth(showPlaceholder && i === 0 ? p.placeholder : line)));
    body.push(`${v} ${prompt}${content}${pad} ${v}`);
  });

  const lines: string[] = [...p.above, top, ...body, bottom];

  // 底部信息行：左状态 + 右提示
  const left = t.c.muted(p.status);
  const right = p.hint ? t.c.muted(p.hint) : '';
  const gap = Math.max(1, boxW - strWidth(left) - strWidth(right));
  lines.push(` ${left}${' '.repeat(gap - 1)}${right}`);

  let cursor: ScreenCursor | null = null;
  if (p.focused) {
    const row = p.above.length + 1 + Math.min(pos.row, Math.max(0, rendered.length - 1));
    const col = 1 /* 边框 */ + 1 /* 内边距 */ + PROMPT_W + (showPlaceholder ? 0 : pos.col);
    cursor = { row, col };
  }

  return { lines, cursor };
}

/** 输入框上方的一行状态（转圈 / 排队提示 / 错误） */
export function statusLine(t: Theme, icon: string, text: string, tail?: string): string {
  const head = `${icon} ${text}`;
  return tail ? `${head} ${t.c.muted(tail)}` : head;
}

export function padLine(s: string, w: number): string {
  return padEnd(s, w);
}
