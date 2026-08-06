/**
 * 渲染器：append-only body + 差分 footer
 *
 * 模型：
 *   ┌ 已提交的正文（滚动缓冲的一部分，永不重绘） ┐
 *   │ ...                                        │
 *   └────────────────────────────────────────────┘
 *   ┌ footer（每帧重绘的活动区）                 ┐
 *   │ 状态行 / 浮层 / 输入框                     │
 *   └────────────────────────────────────────────┘
 *   ▌ ← park line：每帧结束时光标停在这里（footer 下面一行的行首）
 *
 * 不变量：flush() 结束后，光标要么停在 park line 行首，
 * 要么停在 footer 内的输入光标处（此时 curOffset 记录它离 park line 有几行）。
 *
 * 关键约束（都是踩过的坑）：
 *  - 绝不进 alt-screen：正文必须留在滚动缓冲里可翻可复制
 *  - footer 每行必须先被截断到 width-1，否则终端自动折行会打乱行数统计
 *  - 用 CSI J 收尾清理残留行，不用 CSI 2J（会闪、会丢历史）
 *  - 空帧输出 0 字节：没变化就什么都不写，否则流式输出会把终端刷爆
 *  - flush 合并：pending 标志 + 定时器，1000 次 setState 只画 1 帧
 */
import process from 'node:process';
import { seq, detectCaps, type TermCaps } from './ansi.js';
import { truncate } from './width.js';

export interface ScreenCursor {
  /** footer 内的行号（0 基） */
  row: number;
  /** 该行的显示列（0 基） */
  col: number;
}

export interface ScreenOptions {
  out?: NodeJS.WriteStream;
  caps?: TermCaps;
  /** 最小重绘间隔（毫秒）。流式输出时靠它限帧 */
  frameMs?: number;
}

export class Screen {
  readonly caps: TermCaps;
  private out: NodeJS.WriteStream;
  private frameMs: number;

  private footer: string[] = [];
  private cursor: ScreenCursor | null = null;
  private bodyQueue: string[] = [];

  /** 上一帧 footer 占用的物理行数 */
  private drawnRows = 0;
  /** 当前光标在 park line 上方几行 */
  private curOffset = 0;

  private lastFooter: string[] = [];
  private lastCursorKey = '';

  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(opts: ScreenOptions = {}) {
    this.out = opts.out ?? process.stdout;
    this.caps = opts.caps ?? detectCaps(this.out);
    this.frameMs = opts.frameMs ?? 33;
  }

  get width(): number {
    const w = this.out.columns ?? 80;
    return Math.max(20, Math.min(w, 400));
  }

  get height(): number {
    return Math.max(6, this.out.rows ?? 24);
  }

  /** footer 可用的最大行宽（留一列，避开自动折行的边界行为） */
  get innerWidth(): number {
    return Math.max(8, this.width - 1);
  }

  /** 追加正文。内容会永久留在滚动缓冲里 */
  writeBody(lines: string | string[]): void {
    const arr = typeof lines === 'string' ? lines.split('\n') : lines;
    if (arr.length === 0) return;
    this.bodyQueue.push(...arr);
    this.schedule();
  }

  /** 替换 footer。lines 会被自动截断到 innerWidth */
  setFooter(lines: string[], cursor?: ScreenCursor | null): void {
    const w = this.innerWidth;
    this.footer = lines.map((l) => truncate(l, w, '…'));
    this.cursor = cursor ?? null;
    this.schedule();
  }

  /** 合并重绘请求：无论调用多少次，一个帧间隔内只画一帧 */
  schedule(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.frameMs);
    this.timer.unref?.();
  }

  /** 立刻重绘（用于按键响应，避免手感发飘） */
  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  private cursorKey(): string {
    return this.cursor ? `${this.cursor.row}:${this.cursor.col}` : '-';
  }

  private dirty(): boolean {
    if (this.bodyQueue.length) return true;
    if (this.cursorKey() !== this.lastCursorKey) return true;
    if (this.footer.length !== this.lastFooter.length) return true;
    for (let i = 0; i < this.footer.length; i++) {
      if (this.footer[i] !== this.lastFooter[i]) return true;
    }
    return false;
  }

  private flush(): void {
    if (this.closed) return;
    if (!this.dirty()) return; // 空帧：0 字节

    let s = '';

    // 1. 把光标收回 park line
    if (this.curOffset > 0) {
      s += seq.col0 + seq.down(this.curOffset);
      this.curOffset = 0;
    }
    s += seq.hideCursor;

    // 2. 回到 footer 顶部
    if (this.drawnRows > 0) s += seq.up(this.drawnRows);
    s += seq.col0;

    // 3. 正文（不需要行数统计：写完就永久提交）
    if (this.bodyQueue.length) {
      for (const line of this.bodyQueue) s += line + seq.eraseToEol + '\n';
      this.bodyQueue = [];
    }

    // 4. footer
    for (const line of this.footer) s += line + seq.eraseToEol + '\n';
    this.drawnRows = this.footer.length;

    // 5. 清掉下方残留（footer 变短 / 正文顶掉旧内容时）
    s += seq.eraseToEnd;

    // 6. 输入光标
    if (this.cursor && this.drawnRows > 0) {
      const upN = this.drawnRows - this.cursor.row;
      if (upN > 0) {
        s += seq.up(upN) + seq.col0;
        if (this.cursor.col > 0) s += `\x1b[${this.cursor.col}C`;
        this.curOffset = upN;
        s += seq.showCursor;
      }
    }

    if (this.caps.sync) s = seq.syncBegin + s + seq.syncEnd;

    this.out.write(s);
    this.lastFooter = this.footer.slice();
    this.lastCursorKey = this.cursorKey();
  }

  /** /clear 用：清屏 + 清滚动缓冲，重置行数统计 */
  hardClear(): void {
    if (this.closed) return;
    this.out.write(seq.hideCursor + seq.hardClear);
    this.drawnRows = 0;
    this.curOffset = 0;
    this.lastFooter = [];
    this.lastCursorKey = '';
    this.bodyQueue = [];
    this.flushNow();
  }

  /** 退出前清掉 footer，把终端还给用户 */
  close(): void {
    if (this.closed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    let s = '';
    if (this.curOffset > 0) {
      s += seq.col0 + seq.down(this.curOffset);
      this.curOffset = 0;
    }
    if (this.drawnRows > 0) s += seq.up(this.drawnRows);
    s += seq.col0 + seq.eraseToEnd;
    // 还没画出去的正文要补上，否则最后一条错误 / 告别语会被 eraseToEnd 一起抹掉
    if (this.bodyQueue.length) {
      for (const line of this.bodyQueue) s += line + seq.eraseToEol + '\n';
      this.bodyQueue = [];
    }
    s += seq.showCursor;
    this.out.write(s);
    this.drawnRows = 0;
    this.closed = true;
  }
}
