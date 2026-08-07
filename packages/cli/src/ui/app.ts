/**
 * voked CLI 主循环
 *
 * 结构：
 *   Screen  ── 只管往终端吐字节（append-only 正文 + 差分 footer）
 *   KeyReader ─ 只管把 stdin 变成按键事件
 *   App     ── 状态机：编辑 / 浮层 / 运行中，把两者接起来
 *
 * 所有渲染都走 render()，render() 只组装字符串，不直接写终端。
 */
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type {
  Message,
  PermissionAskRequest,
  StreamEvent,
  ToolUse,
} from '../../../core/dist/index.js';
import { t } from '../../../core/dist/index.js';

import { Screen } from '../tui/screen.js';
import { KeyReader, type Key, type PasteEvent } from '../tui/keys.js';
import { Editor } from '../tui/editor.js';
import { detectCaps } from '../tui/ansi.js';
import { makeTheme, pickVerb, type Theme } from '../tui/theme.js';
import { strWidth, truncate, wrapText } from '../tui/width.js';

import { renderComposer } from './composer.js';
import {
  renderOverlay,
  renderConfirm,
  filterItems,
  renderForm,
  type OverlayItem,
  type OverlayState,
  type FormState,
} from './overlay.js';
import {
  renderBanner,
  renderUser,
  renderAssistant,
  renderSystem,
  renderError,
  renderThinking,
  renderToolStart,
  renderToolEnd,
  renderTurnSummary,
  summarizeToolInput,
} from './transcript.js';

import {
  SLASH_COMMANDS,
  buildModelRows,
  handleSlash,
  helpText,
  findCommand,
  commandDisplayName,
  loadHistory,
  appendHistory,
  type SlashContext,
} from '../commands.js';
import {
  createContext,
  runAgent,
  applyModel,
  persistPreference,
  type AgentRunHandle,
  type vokedContext,
} from '../core.js';
import {
  loadGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
  type ModelConfig,
  type ModelProvider,
  type ProviderConfig,
} from '../../../core/dist/index.js';

export interface AppOptions {
  cwd: string;
  version: string;
  modelKey?: string;
  resume?: string;
}

type Phase = 'idle' | 'running';

interface ConfirmState {
  title: string;
  detail: string[];
  options: OverlayItem[];
  index: number;
  resolve: (v: 'allow' | 'deny' | 'allowAll') => void;
}

interface Toast {
  text: string;
  kind: 'info' | 'error' | 'success';
}

const PREVIEW_MAX = 12;

export class App {
  private screen: Screen;
  private keys: KeyReader;
  private theme: Theme;
  private editor = new Editor();

  private ctx!: vokedContext;
  private sessionId = '';

  private phase: Phase = 'idle';
  private handle: AgentRunHandle | null = null;

  private overlay: OverlayState | null = null;
  private confirm: ConfirmState | null = null;
  private form: FormState | null = null;

  private queue: string[] = [];
  private streamBuf = '';
  private thinkBuf = '';
  private stats = { input: 0, output: 0, tools: 0 };
  private turnStart = 0;

  private spinnerTimer: NodeJS.Timeout | null = null;
  private spinnerFrame = 0;
  private verb = pickVerb();

  private toast: Toast | null = null;
  private toastTimer: NodeJS.Timeout | null = null;

  private multiline = false;
  private ctrlCArmed = false;
  private ctrlCTimer: NodeJS.Timeout | null = null;

  private restoreStderr: (() => void) | null = null;
  private exited = false;
  private exitResolve: (() => void) | null = null;

  constructor(private opts: AppOptions) {
    const caps = detectCaps(process.stdout);
    this.theme = makeTheme(caps);
    this.screen = new Screen({ caps, frameMs: 33 });
    this.keys = new KeyReader(process.stdin);
  }

  // ================= 生命周期 =================

  async run(): Promise<void> {
    this.hookStderr();
    this.editor.setHistory(loadHistory());

    this.screen.writeBody(
      renderBanner(this.theme, {
        version: this.opts.version,
        cwd: this.opts.cwd,
        model: t('cli.connecting'),
      })
    );
    this.render(true);

    try {
      this.ctx = await createContext(this.opts.cwd, {
        modelKey: this.opts.modelKey,
        allowNoModel: true,
      });
    } catch (e) {
      this.screen.writeBody(renderError((e as Error).message, this.theme, this.screen.width));
      this.screen.writeBody(
        renderSystem(t('model.none'), this.theme, this.screen.width)
      );
      this.shutdown();
      return;
    }

    await this.initSession();

    if (!this.ctx.model) {
      this.screen.writeBody(renderSystem(t('cli.noModelHint'), this.theme, this.screen.width));
    }

    this.screen.writeBody(
      renderSystem(
        t('cli.toolsReady', { model: this.ctx.model?.config?.model ?? '—', count: this.ctx.tools.length }),
        this.theme,
        this.screen.width
      )
    );

    this.keys.on('key', this.onKey);
    this.keys.on('paste', this.onPaste);
    this.keys.on('resize', this.onResize);
    this.keys.start();

    this.render(true);
    await new Promise<void>((resolve) => {
      this.exitResolve = resolve;
    });
  }

  private async initSession(): Promise<void> {
    if (this.opts.resume) {
      const list = await this.ctx.sessions.list().catch(() => []);
      const found = list.find((s) => s.id === this.opts.resume || s.id.startsWith(this.opts.resume!));
      if (found) {
        this.sessionId = found.id;
        await this.replaySession(found.id);
        return;
      }
      this.pushSystem(t('session.notFound', { id: this.opts.resume }));
    }
    const s = await this.ctx.sessions.create({
      cwd: this.ctx.cwd,
      title: t('session.newTitle'),
      model: this.currentModel(),
    });
    this.sessionId = s.id;
  }

  /** 恢复会话时把历史消息重新打印一遍（只打印最近若干条，避免刷屏） */
  private async replaySession(id: string, limit = 20): Promise<void> {
    const session = await this.ctx.sessions.load(id);
    if (!session) return;
    const msgs = session.messages.slice(-limit);
    if (session.messages.length > msgs.length) {
      this.pushSystem(t('session.omitted', { n: session.messages.length - msgs.length }));
    }
    for (const m of msgs) this.printMessage(m);
    this.pushSystem(t('session.restored', { title: session.title }));
  }

  private printMessage(m: Message): void {
    const w = this.screen.width;
    const text = typeof m.content === 'string'
      ? m.content
      : m.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
    if (m.role === 'user') {
      if (text.trim()) this.screen.writeBody(renderUser(text, this.theme, w));
    } else if (m.role === 'assistant') {
      if (m.thinking) this.screen.writeBody(renderThinking(m.thinking, this.theme, w));
      if (text.trim()) this.screen.writeBody(renderAssistant(text, this.theme, w));
      for (const c of m.toolCalls ?? []) {
        this.screen.writeBody(renderToolStart(c, this.theme, w));
      }
    } else if (m.role === 'tool' && m.toolResult) {
      const call: ToolUse = { id: m.toolResult.toolCallId, name: t('ui.toolResult'), input: {} };
      this.screen.writeBody(renderToolEnd(call, m.toolResult, this.theme, w, 3));
    }
  }

  private shutdown(): void {
    if (this.exited) return;
    this.exited = true;
    this.stopSpinner();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.ctrlCTimer) clearTimeout(this.ctrlCTimer);
    this.keys.stop();
    this.screen.close();
    this.restoreStderr?.();
    void this.ctx?.mcp?.disconnectAll?.().catch(() => undefined);
    this.exitResolve?.();
  }

  /**
   * core / MCP 子进程往 stderr 打的东西会插到 footer 中间把界面打乱。
   * 这里把 stderr 接过来，当成正文行提交，顺序和渲染都可控。
   */
  private hookStderr(): void {
    const orig = process.stderr.write.bind(process.stderr);
    const patched = ((chunk: unknown, enc?: unknown, cb?: unknown): boolean => {
      const s =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : String(chunk);
      const lines = s.replace(/\s+$/, '').split('\n').filter((l) => l.length > 0);
      if (lines.length) {
        this.screen.writeBody(lines.map((l) => this.theme.c.muted(truncate(l, this.screen.width))));
      }
      if (typeof enc === 'function') (enc as () => void)();
      else if (typeof cb === 'function') (cb as () => void)();
      return true;
    }) as typeof process.stderr.write;
    process.stderr.write = patched;
    this.restoreStderr = () => {
      process.stderr.write = orig;
    };
  }

  // ================= 渲染 =================

  private previewLines(): string[] {
    const w = this.screen.innerWidth - 2;
    const src = this.streamBuf || this.thinkBuf;
    if (!src.trim()) return [];
    const dim = this.streamBuf ? false : true;
    const all = wrapText(src.replace(/\s+$/, ''), Math.max(8, w));
    const tail = all.slice(-PREVIEW_MAX);
    const out = tail.map((l) => `  ${dim ? this.theme.c.muted(l) : l}`);
    if (all.length > tail.length) {
      out.unshift(`  ${this.theme.c.muted(`${this.theme.g.ellipsisV} ${t('preview.moreLines', { n: all.length - tail.length })}`)}`);
    }
    return out;
  }

  private spinnerLine(): string {
    const { c, g } = this.theme;
    const frames = g.spinner;
    const icon = c.brand(frames[this.spinnerFrame % frames.length]);
    const secs = ((Date.now() - this.turnStart) / 1000).toFixed(0);
    const tail = c.muted(`(${secs}s · ${t('hint.running.esc')})`);
    return `  ${icon} ${c.bold(this.verb)}… ${tail}`;
  }

  private statusText(): string {
    const { g } = this.theme;
    const cwd = shortenPath(this.ctx?.cwd ?? this.opts.cwd);
    const model = this.currentModel();
    return `${cwd} ${g.dot} ${model}`;
  }

  /** 当前模型 id；尚未配置模型时返回占位符 */
  private currentModel(): string {
    return this.ctx?.model?.config?.model ?? '—';
  }

  private hintText(): string {
    if (this.confirm) return t('hint.confirm');
    if (this.form) return t('hint.form');
    if (this.overlay) return t('hint.overlay');
    if (this.phase === 'running') return t('hint.running');
    if (this.multiline) return t('hint.multiline');
    return t('hint.idle');
  }

  private render(now = false): void {
    const w = this.screen.innerWidth;
    const above: string[] = [];

    if (this.phase === 'running') {
      const p = this.previewLines();
      if (p.length) above.push(...p, '');
      above.push(this.spinnerLine());
    }

    if (this.queue.length) {
      above.push(`  ${this.theme.c.muted(`${this.theme.g.ellipsisV} ${t('queue.count', { n: this.queue.length })}`)}`);
    }

    if (this.toast) {
      const color =
        this.toast.kind === 'error'
          ? this.theme.c.red
          : this.toast.kind === 'success'
            ? this.theme.c.green
            : this.theme.c.muted;
      above.push(`  ${color(this.toast.text)}`);
    }

    if (above.length) above.push('');

    if (this.confirm) {
      above.push(
        ...renderConfirm(
          { title: this.confirm.title, detail: this.confirm.detail, options: this.confirm.options, index: this.confirm.index },
          this.theme,
          w
        )
      );
    } else if (this.form) {
      above.push(...renderForm(this.form, this.theme, w));
    } else if (this.overlay) {
      above.push(...renderOverlay(this.overlay, this.theme, w));
    }

    if (this.form || this.confirm) {
      // 向导 / 确认期间隐藏聊天输入框，所有输入只进表单，避免错位到聊天框
      const hint = this.form ? t('hint.form') : t('hint.confirm');
      const left = this.theme.c.muted(this.statusText());
      const right = this.theme.c.muted(hint);
      const gap = Math.max(1, w - strWidth(left) - strWidth(right));
      this.screen.setFooter([...above, ` ${left}${' '.repeat(Math.max(0, gap - 1))}${right}`], null);
      if (now) this.screen.flushNow();
      return;
    }

    const frame = renderComposer({
      editor: this.editor,
      theme: this.theme,
      width: w,
      placeholder: this.phase === 'running' ? t('placeholder.running') : t('placeholder.idle'),
      above,
      hint: this.hintText(),
      status: this.statusText(),
      dimmed: this.phase === 'running',
      focused: !this.confirm,
      multiline: this.multiline,
    });

    this.screen.setFooter(frame.lines, frame.cursor);
    if (now) this.screen.flushNow();
  }

  private pushSystem(text: string): void {
    this.screen.writeBody(renderSystem(text, this.theme, this.screen.width));
  }

  private pushError(text: string): void {
    this.screen.writeBody(renderError(text, this.theme, this.screen.width));
  }

  private showToast(text: string, kind: Toast['kind'] = 'info', ms = 2500): void {
    this.toast = { text, kind };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.render(true);
    }, ms);
    this.toastTimer.unref?.();
  }

  // ================= 转圈 =================

  private startSpinner(): void {
    this.verb = pickVerb();
    this.spinnerFrame = 0;
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame++;
      this.render();
    }, 90);
    this.spinnerTimer.unref?.();
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  // ================= 输入事件 =================

  private onResize = (): void => {
    this.render(true);
  };

  private onPaste = (p: PasteEvent): void => {
    const text = p.text.replace(/\r\n?/g, '\n');
    if (this.confirm) return;
    if (this.form) {
      const field = this.form.fields[this.form.index];
      if (field && !field.options) {
        // 把粘贴内容送进当前文本字段（Key / URL / 名称都是单行，折叠换行）
        field.value += text.replace(/\n/g, ' ');
        this.render(true);
      }
      return;
    }
    if (this.overlay?.ownFilter) {
      this.overlay.filter += text.replace(/\n/g, ' ');
      this.refreshOverlayItems();
      this.render(true);
      return;
    }
    this.editor.insert(text);
    this.syncCommandPalette();
    this.render(true);
  };

  private onKey = (k: Key): void => {
    try {
      this.dispatchKey(k);
    } catch (e) {
      this.pushError(t('error.ui', { msg: (e as Error).message }));
      this.render(true);
    }
  };

  private dispatchKey(k: Key): void {
    // ---- 全局快捷键 ----
    if (k.ctrl && k.name === 'c') return this.onCtrlC();
    if (k.ctrl && k.name === 'd' && !this.confirm) return this.onCtrlD();
    if (k.ctrl && k.name === 'l') {
      this.clearScreen();
      return;
    }

    if (this.confirm) return this.confirmKey(k);
    if (this.form) return this.formKey(k);
    if (this.overlay && this.overlayKey(k)) return;

    this.editorKey(k);
  }

  private onCtrlC(): void {
    if (this.form) {
      this.cancelForm();
      return;
    }
    if (this.confirm) {
      this.resolveConfirm('deny');
      return;
    }
    if (this.phase === 'running' && this.handle) {
      this.handle.abort();
      this.showToast(t('toast.aborting'), 'error');
      this.render(true);
      return;
    }
    if (this.overlay) {
      this.closeOverlay();
      this.render(true);
      return;
    }
    if (!this.editor.isEmpty) {
      this.editor.clear();
      this.render(true);
      return;
    }
    if (this.ctrlCArmed) {
      this.pushSystem(t('bye'));
      this.shutdown();
      return;
    }
    this.ctrlCArmed = true;
    this.showToast(t('toast.ctrlCExit'), 'info', 1800);
    if (this.ctrlCTimer) clearTimeout(this.ctrlCTimer);
    this.ctrlCTimer = setTimeout(() => {
      this.ctrlCArmed = false;
    }, 1800);
    this.ctrlCTimer.unref?.();
    this.render(true);
  }

  private onCtrlD(): void {
    if (!this.editor.isEmpty) {
      this.editor.del();
      this.render(true);
      return;
    }
    this.pushSystem(t('bye'));
    this.shutdown();
  }

  private clearScreen(): void {
    this.screen.hardClear();
    this.screen.writeBody(
      renderBanner(this.theme, {
        version: this.opts.version,
        cwd: this.ctx?.cwd ?? this.opts.cwd,
        model: this.ctx?.model?.config?.model ?? '—',
      })
    );
    this.render(true);
  }

  // ---- 浮层按键 ----

  private overlayKey(k: Key): boolean {
    const ov = this.overlay;
    if (!ov) return false;

    if (k.name === 'escape') {
      this.closeOverlay();
      ov.onCancel?.();
      this.render(true);
      return true;
    }
    if (k.name === 'up') {
      ov.index = ov.items.length ? (ov.index - 1 + ov.items.length) % ov.items.length : 0;
      this.render(true);
      return true;
    }
    if (k.name === 'down') {
      ov.index = ov.items.length ? (ov.index + 1) % ov.items.length : 0;
      this.render(true);
      return true;
    }
    if (k.name === 'pageup') {
      ov.index = Math.max(0, ov.index - 5);
      this.render(true);
      return true;
    }
    if (k.name === 'pagedown') {
      ov.index = Math.min(ov.items.length - 1, ov.index + 5);
      this.render(true);
      return true;
    }
    if (k.name === 'tab') {
      const it = ov.items[ov.index];
      if (it && ov.kind === 'commands') {
        this.completeCommand(it.value, false);
        return true;
      }
      if (it) {
        void this.pickOverlay(it);
        return true;
      }
      return true;
    }
    if (k.name === 'enter') {
      const it = ov.items[ov.index];
      if (!it) {
        this.closeOverlay();
        // 命令面板没有匹配项时，Enter 不该被吞：让它落到输入框正常提交
        if (ov.kind === 'commands') return false;
        this.render(true);
        return true;
      }
      if (ov.kind === 'commands') {
        this.completeCommand(it.value, true);
        return true;
      }
      void this.pickOverlay(it);
      return true;
    }

    // 自带过滤输入的浮层（模型 / 会话）
    if (ov.ownFilter) {
      if (k.name === 'backspace') {
        ov.filter = [...ov.filter].slice(0, -1).join('');
        this.refreshOverlayItems();
        this.render(true);
        return true;
      }
      if (k.name === 'char' && k.ch && !k.ctrl && !k.meta) {
        ov.filter += k.ch;
        this.refreshOverlayItems();
        this.render(true);
        return true;
      }
      return true; // 吞掉其余按键，别漏进输入框
    }

    return false; // 命令面板：其余按键交给输入框，靠输入内容过滤
  }

  private async pickOverlay(it: OverlayItem): Promise<void> {
    const ov = this.overlay;
    if (!ov) return;
    this.closeOverlay();
    this.render(true);
    await ov.onPick(it.value, it);
    this.render(true);
  }

  private closeOverlay(): void {
    this.overlay = null;
  }

  private refreshOverlayItems(): void {
    const ov = this.overlay;
    if (!ov || !ov.ownFilter) return;
    const all = ov.allItems ?? ov.items;
    ov.allItems = all;
    ov.items = filterItems(all, ov.filter);
    ov.index = Math.min(ov.index, Math.max(0, ov.items.length - 1));
  }

  // ---- 命令面板 ----

  /** 输入框内容变化时同步命令面板的显隐与过滤 */
  private syncCommandPalette(): void {
    if (this.overlay && this.overlay.kind !== 'commands') return;
    const text = this.editor.text;
    const m = /^\/(\S*)$/.exec(text);
    if (!m) {
      if (this.overlay?.kind === 'commands') this.closeOverlay();
      return;
    }
    const q = m[1].toLowerCase();
    const items: OverlayItem[] = SLASH_COMMANDS.filter((c) => !c.hidden)
      .filter((c) => !q || c.cmd.startsWith(q) || (c.aliases ?? []).some((a) => a.startsWith(q)))
      .map((c) => ({
        value: c.cmd,
        label: `/${commandDisplayName(c)}`,
        hint: c.description,
      }));

    if (this.overlay?.kind === 'commands') {
      const prev = this.overlay.items[this.overlay.index]?.value;
      this.overlay.items = items;
      const keep = items.findIndex((i) => i.value === prev);
      this.overlay.index = keep >= 0 ? keep : 0;
      this.overlay.filter = q;
    } else {
      this.overlay = {
        kind: 'commands',
        title: t('overlay.commandsTitle'),
        items,
        index: 0,
        filter: q,
        ownFilter: false,
        footer: t('overlay.commandsFooter'),
        onPick: () => undefined,
      };
    }
  }

  private completeCommand(cmd: string, execute: boolean): void {
    const def = findCommand(cmd);
    if (!execute || def?.needsArgs) {
      this.editor.setText(`/${cmd} `);
      this.closeOverlay();
      this.render(true);
      return;
    }
    this.editor.setText(`/${cmd}`);
    this.closeOverlay();
    this.handleSubmit();
  }

  // ---- 输入框按键 ----

  private editorKey(k: Key): void {
    const e = this.editor;

    switch (k.name) {
      case 'enter': {
        const wantNewline = this.multiline ? !(k.meta || k.ctrl) : k.meta || k.ctrl;
        if (wantNewline) {
          e.insert('\n');
          break;
        }
        if (e.text.endsWith('\\')) {
          e.setText(e.text.slice(0, -1) + '\n');
          break;
        }
        this.handleSubmit();
        return;
      }
      case 'escape':
        if (this.phase === 'running' && this.handle) {
          this.handle.abort();
          this.showToast(t('toast.aborting'), 'error');
        }
        break;
      case 'backspace':
        if (k.meta) e.deleteWordBefore();
        else e.backspace();
        break;
      case 'delete':
        e.del();
        break;
      case 'left':
        if (k.ctrl || k.meta) e.wordLeft();
        else e.left();
        break;
      case 'right':
        if (k.ctrl || k.meta) e.wordRight();
        else e.right();
        break;
      case 'up':
        if (!e.up()) e.historyPrev();
        break;
      case 'down':
        if (!e.down()) e.historyNext();
        break;
      case 'home':
        e.home();
        break;
      case 'end':
        e.end();
        break;
      case 'tab':
        // 没有浮层时 Tab 用来触发命令面板
        if (e.text.startsWith('/')) this.syncCommandPalette();
        break;
      case 'char': {
        if (k.meta && (k.ch === 'm' || k.ch === 'M')) {
          this.multiline = !this.multiline;
          this.showToast(this.multiline ? t('toast.multilineOn') : t('toast.multilineOff'), 'info', 1500);
          break;
        }
        if (k.ctrl || !k.ch) break;
        e.insert(k.ch);
        break;
      }
      default:
        if (k.ctrl) {
          if (k.name === 'w') e.deleteWordBefore();
          else if (k.name === 'u') e.killToLineStart();
          else if (k.name === 'k') e.killToLineEnd();
          else if (k.name === 'a') e.home();
          else if (k.name === 'e') e.end();
          else if (k.name === 'b') e.left();
          else if (k.name === 'f') e.right();
        }
        break;
    }

    this.syncCommandPalette();
    this.render(true);
  }

  // ---- 权限确认 ----

  private confirmKey(k: Key): void {
    const c = this.confirm;
    if (!c) return;
    if (k.name === 'up') {
      c.index = (c.index - 1 + c.options.length) % c.options.length;
    } else if (k.name === 'down') {
      c.index = (c.index + 1) % c.options.length;
    } else if (k.name === 'escape') {
      this.resolveConfirm('deny');
      return;
    } else if (k.name === 'enter') {
      this.resolveConfirm(c.options[c.index].value as 'allow' | 'deny' | 'allowAll');
      return;
    } else if (k.name === 'char' && k.ch) {
      const ch = k.ch.toLowerCase();
      if (ch === 'y') return this.resolveConfirm('allow');
      if (ch === 'n') return this.resolveConfirm('deny');
      if (ch === 'a' && c.options.some((o) => o.value === 'allowAll')) return this.resolveConfirm('allowAll');
      const n = Number.parseInt(ch, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= c.options.length) {
        return this.resolveConfirm(c.options[n - 1].value as 'allow' | 'deny' | 'allowAll');
      }
    }
    this.render(true);
  }

  private resolveConfirm(v: 'allow' | 'deny' | 'allowAll'): void {    const c = this.confirm;
    if (!c) return;
    this.confirm = null;
    const label = v === 'allow' ? t('permission.allowed') : v === 'allowAll' ? t('permission.allowedAll') : t('permission.denied');
    this.screen.writeBody([`     ${v === 'deny' ? this.theme.c.red(label) : this.theme.c.green(label)}`]);
    c.resolve(v);
    this.render(true);
  }

  private askPermission(req: PermissionAskRequest): Promise<'allow' | 'deny' | 'allowAll'> {
    return new Promise((resolve) => {
      this.commitAssistant();
      const detail: string[] = [];
      if (req.description) detail.push(req.description);
      const main = summarizeToolInput(req.tool, req.input);
      if (main) detail.push(main);
      const extra = Object.entries(req.input)
        .filter(([, v]) => typeof v !== 'string' || v.length < 200)
        .slice(0, 4)
        .map(([kk, v]) => `${kk}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      detail.push(...extra);

      const options: OverlayItem[] = [{ value: 'allow', label: t('permission.allow'), hint: 'y / Enter' }];
      if (req.options.allowAll) {
        options.push({ value: 'allowAll', label: req.options.allowAll || t('permission.allowAll'), hint: 'a' });
      }
      options.push({ value: 'deny', label: t('permission.deny'), hint: 'n / Esc' });

      this.confirm = {
        title: t('permission.title', { tool: req.tool }),
        detail,
        options,
        index: 0,
        resolve,
      };
      this.render(true);
    });
  }

  // ================= 提交与执行 =================

  private handleSubmit(): void {
    const text = this.editor.text;
    if (!text.trim()) {
      this.render(true);
      return;
    }
    this.editor.pushHistory(text);
    appendHistory(text);
    this.editor.clear();
    this.closeOverlay();

    if (this.phase === 'running') {
      this.queue.push(text);
      this.render(true);
      return;
    }
    void this.dispatchInput(text);
  }

  private async dispatchInput(text: string): Promise<void> {
    const t = text.trim();
    try {
      if (t.startsWith('!')) await this.runShell(t.slice(1).trim());
      else if (t.startsWith('/')) await this.runSlash(t);
      else await this.runTurn(text);
    } catch (e) {
      this.pushError((e as Error).message);
    }
    this.render(true);
    await this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length && !this.exited) {
      const next = this.queue.shift()!;
      this.render(true);
      await this.dispatchInput(next);
    }
  }

  // ---- shell 直通 ----

  private runShell(cmd: string): Promise<void> {
    if (!cmd) {
      this.pushSystem(t('shell.usage'));
      return Promise.resolve();
    }
    this.screen.writeBody(['', `  ${this.theme.c.yellow('$')} ${this.theme.c.bold(cmd)}`]);
    return new Promise<void>((resolve) => {
      const child = spawn(cmd, {
        shell: true,
        cwd: this.ctx.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const emit = (buf: Buffer, err: boolean): void => {
        const lines = buf.toString('utf8').replace(/\s+$/, '').split('\n');
        this.screen.writeBody(
          lines.map((l) => `     ${err ? this.theme.c.red(l) : this.theme.c.muted(l)}`)
        );
      };
      child.stdout?.on('data', (b: Buffer) => emit(b, false));
      child.stderr?.on('data', (b: Buffer) => emit(b, true));
      child.on('error', (e) => {
        this.pushError(e.message);
        resolve();
      });
      child.on('close', (code) => {
        if (code !== 0 && code != null) this.screen.writeBody([`     ${this.theme.c.muted(t('shell.exitCode', { code }))}`]);
        resolve();
      });
    });
  }

  // ---- slash ----

  private async runSlash(line: string): Promise<void> {
    const sc: SlashContext = {
      ctx: this.ctx,
      sessionId: this.sessionId,
      setModel: async (key) => {
        applyModel(this.ctx, key);
        await persistPreference({ defaultModel: key }).catch(() => undefined);
        return t('model.switched', { key, model: this.currentModel() });
      },
      newSession: async (title) => {
        const s = await this.ctx.sessions.create({
          cwd: this.ctx.cwd,
          title: title || t('session.newTitle'),
          model: this.currentModel(),
        });
        this.sessionId = s.id;
        return t('session.created', { title: s.title, id: s.id.slice(0, 8) });
      },
      resumeSession: async (id) => {
        const list = await this.ctx.sessions.list();
        const found = list.find((s) => s.id === id || s.id.startsWith(id));
        if (!found) throw new Error(t('session.notFoundErr', { id }));
        this.sessionId = found.id;
        await this.replaySession(found.id);
        return '';
      },
      switchProject: async (dir) => {
        const target = path.resolve(this.ctx.cwd, dir);
        const st = await fs.stat(target);
        if (!st.isDirectory()) throw new Error(t('session.notDir'));
        await this.ctx.mcp.disconnectAll().catch(() => undefined);
        this.ctx = await createContext(target, { modelKey: this.ctx.config.defaultModel, allowNoModel: true });
        const s = await this.ctx.sessions.create({
          cwd: target,
          title: path.basename(target),
          model: this.currentModel(),
        });
        this.sessionId = s.id;
        return target;
      },
      exit: () => this.shutdown(),
    };

    const res = await handleSlash(line, sc);
    if (res.clear) this.clearScreen();
    if (res.message) this.pushSystem(res.message);
    if (res.error) this.pushError(res.error);
    if (res.modal === 'help') this.pushSystem(helpText());
    if (res.modal === 'model') this.openModelPicker(sc);
    if (res.modal === 'session') await this.openSessionPicker(sc);
    if (res.modal === 'connect') this.openConnectWizard(res.connectKind ?? 'provider');
  }

  private openModelPicker(sc: SlashContext): void {
    const rows = buildModelRows(this.ctx.config);
    if (!rows.length) {
      this.pushSystem(t('model.none'));
      return;
    }
    const items: OverlayItem[] = rows.map((r) => ({
      value: r.key,
      label: r.key,
      hint: r.model,
      group: r.providerLabel,
      marked: r.isCurrent,
    }));
    const cur = Math.max(0, items.findIndex((i) => i.marked));
    this.overlay = {
      kind: 'models',
      title: t('overlay.modelTitle'),
      items,
      allItems: items,
      index: cur,
      filter: '',
      ownFilter: true,
      footer: t('overlay.filterHint'),
      onPick: async (key) => {
        try {
          this.pushSystem(await sc.setModel(key));
        } catch (e) {
          this.pushError((e as Error).message);
        }
      },
    };
    this.render(true);
  }

  private async openSessionPicker(sc: SlashContext): Promise<void> {
    const list = await this.ctx.sessions.list().catch(() => []);
    if (!list.length) {
      this.pushSystem(t('session.empty'));
      return;
    }
    const items: OverlayItem[] = list.slice(0, 50).map((s) => ({
      value: s.id,
      label: s.title || t('session.untitled'),
      hint: new Date(s.updatedAt).toLocaleString(),
      detail: s.cwd,
      marked: s.id === this.sessionId,
    }));
    this.overlay = {
      kind: 'sessions',
      title: t('session.resumeTitle'),
      items,
      allItems: items,
      index: 0,
      filter: '',
      ownFilter: true,
      footer: t('overlay.filterHint'),
      onPick: async (id) => {
        try {
          await sc.resumeSession(id);
        } catch (e) {
          this.pushError((e as Error).message);
        }
      },
    };
    this.render(true);
  }

  // ---- /connect 交互向导 ----

  private openConnectWizard(kind: 'provider' | 'mcp'): void {
    if (kind === 'mcp') {
      this.pushSystem(t('connect.mcpNotImpl'));
      this.render(true);
      return;
    }

    const typeOptions = [
      { value: 'openai-compatible', label: t('connect.type.openai-compatible') },
      { value: 'openai-responses', label: t('connect.type.openai-responses') },
      { value: 'anthropic', label: t('connect.type.anthropic') },
      { value: 'gemini', label: t('connect.type.gemini') },
    ];
    const yesNo = [
      { value: 'yes', label: t('connect.defaultYes') },
      { value: 'no', label: t('connect.defaultNo') },
    ];

    this.form = {
      title: t('connect.providerTitle'),
      index: 0,
      selectIndex: 0,
      fields: [
        { key: 'type', label: t('connect.chooseType'), value: 'openai-compatible', options: typeOptions },
        { key: 'label', label: t('connect.label'), value: '', placeholder: 'DeepSeek' },
        { key: 'apiKey', label: t('connect.apiKey'), value: '', placeholder: 'sk-...', secret: true },
        { key: 'baseURL', label: t('connect.baseURL'), value: '', placeholder: 'https://api.deepseek.com/v1' },
        { key: 'model', label: t('connect.model'), value: '', placeholder: 'deepseek-chat' },
        { key: 'default', label: t('connect.setDefault'), value: 'yes', options: yesNo },
      ],
    };
    this.render(true);
  }

  private formKey(k: Key): void {
    const f = this.form;
    if (!f) return;
    const field = f.fields[f.index];

    if (k.name === 'escape') {
      this.cancelForm();
      return;
    }

    if (field.options) {
      const n = field.options.length;
      if (k.name === 'up') f.selectIndex = (f.selectIndex - 1 + n) % n;
      else if (k.name === 'down') f.selectIndex = (f.selectIndex + 1) % n;
      else if (k.name === 'pageup') f.selectIndex = Math.max(0, f.selectIndex - 5);
      else if (k.name === 'pagedown') f.selectIndex = Math.min(n - 1, f.selectIndex + 5);
      else if (k.name === 'enter' || k.name === 'tab') {
        field.value = field.options[f.selectIndex].value;
        this.advanceForm();
        return;
      } else {
        return;
      }
      this.render(true);
      return;
    }

    // 文本输入型
    if (k.name === 'backspace') {
      field.value = [...field.value].slice(0, -1).join('');
    } else if (k.name === 'enter') {
      this.advanceForm();
      return;
    } else if (k.name === 'char' && k.ch && !k.ctrl && !k.meta) {
      field.value += k.ch;
    } else {
      return;
    }
    this.render(true);
  }

  private advanceForm(): void {
    const f = this.form;
    if (!f) return;
    if (f.index < f.fields.length - 1) {
      f.index++;
      const nf = f.fields[f.index];
      if (nf.options) {
        const i = nf.options.findIndex((o) => o.value === nf.value);
        f.selectIndex = i >= 0 ? i : 0;
      }
      this.render(true);
      return;
    }
    // 最后一步：收集并保存
    const values: Record<string, string> = {};
    for (const fld of f.fields) values[fld.key] = fld.value;
    this.form = null;
    void this.finishConnect(values);
  }

  private cancelForm(): void {
    this.form = null;
    this.showToast(t('connect.cancel'), 'info', 2000);
    this.render(true);
  }

  private async finishConnect(values: Record<string, string>): Promise<void> {
    try {
      const label = values.label.trim();
      const model = values.model.trim();
      const apiKey = values.apiKey.trim();
      const baseURL = values.baseURL.trim();
      const type = values.type as ModelProvider;

      if (!label) throw new Error(t('connect.invalid', { msg: t('connect.label') }));
      if (!model) throw new Error(t('connect.invalid', { msg: t('connect.model') }));
      // 把空字符串当成「未填写」：
      if (!apiKey && !baseURL) {
        // 允许两者都空（走协议默认），但至少提示一下？这里放行。
      }

      const pid = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'provider';
      const modelKey = `${pid}:${model}`;

      const global = await loadGlobalConfig();
      global.providers = global.providers ?? {};
      global.models = global.models ?? {};

      const provider: ProviderConfig = {
        label,
        type,
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
      };
      const mcfg: ModelConfig = {
        provider: type,
        providerId: pid,
        model,
        apiKey: apiKey || undefined,
        baseURL: baseURL || undefined,
      };

      const existed = !!global.providers[pid];
      global.providers[pid] = provider;
      global.models[modelKey] = mcfg;
      // 没有合法默认模型时把新模型设为默认；或用户明确要求
      if (values.default === 'yes' || !global.defaultModel || global.defaultModel === '__env__') {
        global.defaultModel = modelKey;
      }

      await saveGlobalConfig(global);

      // 让当前会话立即生效：刷新内存中的配置并切换 adapter
      this.ctx.config = global;
      if (global.defaultModel) {
        try {
          applyModel(this.ctx, global.defaultModel);
        } catch {
          /* 切换失败不应阻塞保存结果 */
        }
      }

      const saved = existed ? t('connect.providerExists', { id: pid }) : '';
      this.pushSystem(t('connect.saved', { label, model, key: modelKey }) + (saved ? `\n${saved}` : ''));
    } catch (e) {
      this.pushError((e as Error).message);
    }
    this.render(true);
  }

  // ---- 一轮对话 ----

  private commitAssistant(): void {
    const w = this.screen.width;
    if (this.thinkBuf.trim()) {
      this.screen.writeBody(renderThinking(this.thinkBuf, this.theme, w));
      this.thinkBuf = '';
    }
    if (this.streamBuf.trim()) {
      this.screen.writeBody(renderAssistant(this.streamBuf, this.theme, w));
      this.streamBuf = '';
    }
  }

  private async runTurn(text: string): Promise<void> {
    const w = this.screen.width;

    if (!this.ctx.model) {
      this.screen.writeBody(renderUser(text, this.theme, w));
      this.pushSystem(t('cli.noModelHint'));
      this.render(true);
      return;
    }

    this.screen.writeBody(renderUser(text, this.theme, w));

    this.phase = 'running';
    this.streamBuf = '';
    this.thinkBuf = '';
    this.stats = { input: 0, output: 0, tools: 0 };
    this.turnStart = Date.now();
    this.startSpinner();
    this.render(true);

    let aborted = false;
    const handle = runAgent(
      this.ctx,
      this.sessionId,
      { text },
      {
        onEvent: (ev: StreamEvent) => {
          switch (ev.type) {
            case 'text_delta':
              this.streamBuf += ev.text;
              this.render();
              break;
            case 'thinking_delta':
              this.thinkBuf += ev.text;
              this.render();
              break;
            case 'usage':
              this.stats.input += ev.input;
              this.stats.output += ev.output;
              break;
            case 'error':
              this.commitAssistant();
              this.pushError(ev.error.message);
              break;
            default:
              break;
          }
        },
        onToolStart: (call) => {
          this.commitAssistant();
          this.stats.tools++;
          this.screen.writeBody(renderToolStart(call, this.theme, w));
          this.render();
        },
        onToolEnd: (call, res) => {
          this.screen.writeBody(renderToolEnd(call, res, this.theme, w));
          this.render();
        },
        onPermissionAsk: (req) => this.askPermission(req),
      }
    );
    this.handle = handle;

    try {
      await handle.promise;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/abort/i.test(msg)) aborted = true;
      else this.pushError(msg);
    } finally {
      this.commitAssistant();
      this.stopSpinner();
      this.handle = null;
      this.phase = 'idle';
      if (this.confirm) this.resolveConfirm('deny');
      if (aborted) this.pushSystem(t('turn.aborted'));
      this.screen.writeBody(
        renderTurnSummary({ ms: Date.now() - this.turnStart, ...this.stats }, this.theme)
      );
      this.render(true);
    }
  }
}

function shortenPath(p: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  let s = p;
  if (home && s.startsWith(home)) s = '~' + s.slice(home.length);
  s = s.replace(/\\/g, '/');
  const parts = s.split('/');
  if (parts.length > 4) return `${parts[0]}/…/${parts.slice(-2).join('/')}`;
  return s;
}
