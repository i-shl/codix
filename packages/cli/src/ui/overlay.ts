/**
 * 浮层：命令面板 / 模型选择 / 会话选择 / 权限确认
 *
 * 全部落在输入框上方的 footer 区，不遮挡正文，也不进 alt-screen。
 */
import type { Theme } from '../tui/theme.js';
import { t as T } from '../../../core/dist/index.js';
import { strWidth, truncate, padEnd } from '../tui/width.js';

export interface OverlayItem {
  /** 选中后回传给 onPick 的值 */
  value: string;
  label: string;
  /** 右侧灰字 */
  hint?: string;
  /** 第二行说明 */
  detail?: string;
  /** 左侧标记（例如当前模型的 ●） */
  marked?: boolean;
  /** 分组标题（渲染成不可选的一行） */
  group?: string;
}

export type OverlayKind = 'commands' | 'models' | 'sessions' | 'confirm' | 'info';

export interface OverlayState {
  kind: OverlayKind;
  title: string;
  /** 当前可见（已过滤）的项 */
  items: OverlayItem[];
  /** 过滤前的全集，ownFilter 浮层用 */
  allItems?: OverlayItem[];
  index: number;
  /** 命令面板用输入框本身过滤；模型/会话用自己的过滤串 */
  filter: string;
  ownFilter: boolean;
  footer?: string;
  onPick: (value: string, item: OverlayItem) => void | Promise<void>;
  onCancel?: () => void;
}

const MAX_ROWS = 10;

export function filterItems(items: OverlayItem[], q: string): OverlayItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(
    (it) =>
      it.value.toLowerCase().includes(needle) ||
      it.label.toLowerCase().includes(needle) ||
      (it.hint ?? '').toLowerCase().includes(needle) ||
      (it.group ?? '').toLowerCase().includes(needle)
  );
}

export function renderOverlay(ov: OverlayState, t: Theme, width: number): string[] {
  const w = Math.max(24, width);
  const items = ov.items;
  const total = items.length;

  const out: string[] = [];
  const head = ov.ownFilter && ov.filter
    ? `${ov.title} ${t.c.muted(`/ ${ov.filter}`)}`
    : ov.title;
  out.push(`  ${t.c.bold(t.c.brand(head))} ${t.c.muted(total ? `(${total})` : '')}`);

  if (total === 0) {
    out.push(`  ${t.c.muted(T('overlay.noMatch'))}`);
  } else {
    // 视窗滚动：保证选中项始终可见
    const rows = Math.min(MAX_ROWS, total);
    let start = Math.max(0, Math.min(ov.index - Math.floor(rows / 2), total - rows));
    if (start < 0) start = 0;
    const end = Math.min(total, start + rows);

    let lastGroup: string | undefined;
    for (let i = start; i < end; i++) {
      const it = items[i];
      if (it.group && it.group !== lastGroup) {
        lastGroup = it.group;
        out.push(`   ${t.c.muted(it.group)}`);
      }
      const sel = i === ov.index;
      const mark = it.marked ? t.c.green(t.g.bullet) : ' ';
      const pointer = sel ? t.c.brand(t.g.caret) : ' ';
      const labelW = Math.max(8, w - 10 - strWidth(it.hint ?? ''));
      const label = truncate(it.label, labelW);
      const body = `${pointer} ${mark} ${sel ? t.c.bold(label) : label}`;
      const hint = it.hint ? t.c.muted(it.hint) : '';
      const gap = Math.max(1, w - strWidth(body) - strWidth(hint) - 2);
      out.push(` ${body}${' '.repeat(gap)}${hint}`);
      if (sel && it.detail) out.push(`     ${t.c.muted(truncate(it.detail, w - 6))}`);
    }

    if (end < total) out.push(`  ${t.c.muted(`${t.g.ellipsisV} ${T('overlay.more', { n: total - end })}`)}`);
  }

  if (ov.footer) out.push(`  ${t.c.muted(ov.footer)}`);
  out.push('');
  return out;
}

/** 权限确认面板：比列表更醒目，带工具入参预览 */
export interface ConfirmProps {
  title: string;
  detail: string[];
  options: OverlayItem[];
  index: number;
}

export function renderConfirm(p: ConfirmProps, t: Theme, width: number): string[] {
  const w = Math.max(24, width);
  const out: string[] = [];
  out.push(`  ${t.c.bold(t.c.yellow(p.title))}`);
  for (const d of p.detail.slice(0, 8)) out.push(`  ${t.c.muted(truncate(d, w - 4))}`);
  out.push('');
  p.options.forEach((o, i) => {
    const sel = i === p.index;
    const pointer = sel ? t.c.brand(t.g.caret) : ' ';
    const label = sel ? t.c.bold(o.label) : o.label;
    const hint = o.hint ? ` ${t.c.muted(o.hint)}` : '';
    out.push(` ${pointer} ${label}${hint}`);
  });
  out.push('');
  return out;
}

export function padTo(s: string, w: number): string {
  return padEnd(s, w);
}

// ===================== 多步表单（/connect 向导） =====================

export interface FormField {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  /** 密码类字段：显示时打码 */
  secret?: boolean;
  /** 有 options 即为「选择型」字段，否则为「文本输入型」 */
  options?: { value: string; label: string }[];
}

export interface FormState {
  title: string;
  fields: FormField[];
  /** 当前字段下标 */
  index: number;
  /** 选择型字段的游标 */
  selectIndex: number;
}

/** 渲染当前这一步：标题 + 步骤计数 + 问题 + 选项/输入框 + 提示 */
export function renderForm(f: FormState, t: Theme, width: number): string[] {
  const w = Math.max(24, width);
  const out: string[] = [];
  const cur = f.fields[f.index];
  const step = T('connect.step', { i: f.index + 1, n: f.fields.length });
  out.push(`  ${t.c.bold(t.c.brand(f.title))} ${t.c.muted(step)}`);
  out.push(`  ${cur.label}`);
  out.push('');

  if (cur.options) {
    cur.options.forEach((opt, i) => {
      const sel = i === f.selectIndex;
      const pointer = sel ? t.c.brand(t.g.caret) : ' ';
      const label = sel ? t.c.bold(opt.label) : opt.label;
      out.push(` ${pointer} ${label}`);
    });
  } else {
    const display = cur.secret ? '*'.repeat(cur.value.length) : cur.value;
    const show = display ? display : t.c.muted(cur.placeholder ?? '');
    out.push(`  ${t.c.brand('>')} ${show}${t.c.brand('_')}`);
  }

  out.push('');
  out.push(`  ${t.c.muted(T('hint.form'))}`);
  out.push('');
  return out;
}
