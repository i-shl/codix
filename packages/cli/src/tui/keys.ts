/**
 * stdin 原始字节 → 按键事件
 *
 * 为什么不用 readline：readline 会自己回显、自己处理历史、自己抢光标，
 * 和「我们自己画 footer」的模型直接冲突。这里全部自己解析。
 *
 * Windows 注意事项：
 *  - 粘贴会被拆成很多个 data chunk，必须合并，否则每个字符触发一次重绘 → 卡死
 *  - 开启 bracketed paste，但 conhost 不一定支持，所以还有一层「突发合并」兜底
 *  - 绝不开 Kitty keyboard protocol（conhost 会把请求当成可见文本打出来）
 */
import process from 'node:process';
import { EventEmitter } from 'node:events';
import { seq } from './ansi.js';

export interface Key {
  /** 归一化名字：'char' | 'up' | 'enter' | 'backspace' … */
  name: string;
  /** name === 'char' 时的字符（可能是多码点的 emoji） */
  ch?: string;
  ctrl: boolean;
  meta: boolean; // Alt
  shift: boolean;
  /** 原始序列，调试用 */
  raw: string;
}

export interface PasteEvent {
  text: string;
}

const SS3: Record<string, string> = {
  A: 'up', B: 'down', C: 'right', D: 'left',
  H: 'home', F: 'end',
  P: 'f1', Q: 'f2', R: 'f3', S: 'f4',
};

const CSI_TILDE: Record<string, string> = {
  '1': 'home', '2': 'insert', '3': 'delete', '4': 'end',
  '5': 'pageup', '6': 'pagedown', '7': 'home', '8': 'end',
  '11': 'f1', '12': 'f2', '13': 'f3', '14': 'f4', '15': 'f5',
  '17': 'f6', '18': 'f7', '19': 'f8', '20': 'f9', '21': 'f10',
  '23': 'f11', '24': 'f12',
};

/** xterm 修饰键位掩码：1 + (1=shift, 2=alt, 4=ctrl) */
function decodeModifier(mod: number): { shift: boolean; meta: boolean; ctrl: boolean } {
  const m = Math.max(0, mod - 1);
  return { shift: !!(m & 1), meta: !!(m & 2), ctrl: !!(m & 4) };
}

const CTRL_NAMES: Record<number, string> = {
  1: 'a', 2: 'b', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h',
  11: 'k', 12: 'l', 14: 'n', 16: 'p', 17: 'q', 18: 'r',
  19: 's', 20: 't', 21: 'u', 22: 'v', 23: 'w', 24: 'x',
  25: 'y', 26: 'z',
};

/** 单次突发的硬上限：超过就先吐出去，防止恶意/超大粘贴把内存撑爆 */
const BURST_HARD_CAP = 256 * 1024;

export interface KeyReaderOptions {
  /** 粘贴突发合并窗口（毫秒）。Windows 的 stdin 分片更碎，需要更长 */
  pasteWindowMs?: number;
  /** 多少字节以上直接判定为粘贴 */
  pasteThreshold?: number;
}

export declare interface KeyReader {
  on(ev: 'key', cb: (k: Key) => void): this;
  on(ev: 'paste', cb: (p: PasteEvent) => void): this;
  on(ev: 'resize', cb: () => void): this;
}

export class KeyReader extends EventEmitter {
  private buf = '';
  private started = false;
  private pasteWindowMs: number;
  private pasteThreshold: number;
  private burst = '';
  private burstTimer: NodeJS.Timeout | null = null;
  private inBracketedPaste = false;
  private bracketedBuf = '';

  private onData = (chunk: Buffer | string): void => {
    this.feed(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  };
  private onResize = (): void => {
    this.emit('resize');
  };

  constructor(private stdin: NodeJS.ReadStream = process.stdin, opts: KeyReaderOptions = {}) {
    super();
    this.pasteWindowMs = opts.pasteWindowMs ?? (process.platform === 'win32' ? 15 : 4);
    this.pasteThreshold = opts.pasteThreshold ?? 24;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // 开启 bracketed paste：支持的终端会把一次粘贴包进 \e[200~ ... \e[201~，
    // 整段作为单个 paste 事件，不会把换行当成 Enter 逐行提交。
    // 不支持的终端（老 conhost）会忽略该序列，退化为下方的「突发合并」兜底。
    try { process.stdout.write(seq.bracketedPasteOn); } catch { /* 忽略 */ }
    if (this.stdin.isTTY) this.stdin.setRawMode(true);
    this.stdin.setEncoding('utf8');
    this.stdin.resume();
    this.stdin.on('data', this.onData);
    process.stdout.on('resize', this.onResize);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.flushBurst();
    try { process.stdout.write(seq.bracketedPasteOff); } catch { /* 忽略 */ }
    this.stdin.off('data', this.onData);
    process.stdout.off('resize', this.onResize);
    if (this.stdin.isTTY) {
      try {
        this.stdin.setRawMode(false);
      } catch {
        /* 终端已关闭 */
      }
    }
    this.stdin.pause();
  }

  /** 供测试直接注入 */
  feed(s: string): void {
    // ---- bracketed paste ----
    if (this.inBracketedPaste) {
      const end = s.indexOf('\x1b[201~');
      if (end === -1) {
        this.bracketedBuf += s;
        return;
      }
      this.bracketedBuf += s.slice(0, end);
      this.inBracketedPaste = false;
      const text = this.bracketedBuf;
      this.bracketedBuf = '';
      if (text) this.emit('paste', { text });
      this.feed(s.slice(end + 6));
      return;
    }
    const start = s.indexOf('\x1b[200~');
    if (start !== -1) {
      this.feed(s.slice(0, start));
      this.inBracketedPaste = true;
      this.bracketedBuf = '';
      this.feed(s.slice(start + 6));
      return;
    }

    this.buf += s;
    this.drain();
  }

  private drain(): void {
    while (this.buf.length) {
      const consumed = this.parseOne();
      if (consumed === 0) return; // 序列不完整，等下一个 chunk
    }
  }

  /** 解析 buf 开头的一个按键，返回消费的字符数（0 = 需要更多数据） */
  private parseOne(): number {
    const b = this.buf;
    const c0 = b.charCodeAt(0);

    // ---- ESC 开头的序列 ----
    if (c0 === 0x1b) {
      if (b.length === 1) {
        // 孤立 ESC：可能是 Esc 键，也可能是序列开头。等一小会儿。
        this.scheduleLoneEscape();
        return 0;
      }
      const c1 = b[1];

      // CSI
      if (c1 === '[') {
        const m = /^\x1b\[([0-9;]*)([ -/]*)([@-~])/.exec(b);
        if (!m) return 0; // 未完整
        const [full, params, , final] = m;
        this.buf = b.slice(full.length);
        this.emitCsi(params, final, full);
        return full.length;
      }

      // SS3（应用光标键模式，某些终端的方向键）
      if (c1 === 'O') {
        if (b.length < 3) return 0;
        const final = b[2];
        this.buf = b.slice(3);
        const name = SS3[final];
        this.push({ name: name ?? 'unknown', ctrl: false, meta: false, shift: false, raw: b.slice(0, 3) });
        return 3;
      }

      // Alt + 字符
      {
        const cp = b.codePointAt(1);
        const ch = cp === undefined ? '' : String.fromCodePoint(cp);
        const len = 1 + ch.length;
        this.buf = b.slice(len);
        if (ch === '\x7f' || ch === '\b') {
          this.push({ name: 'backspace', ctrl: false, meta: true, shift: false, raw: b.slice(0, len) });
        } else if (ch === '\r' || ch === '\n') {
          this.push({ name: 'enter', ctrl: false, meta: true, shift: false, raw: b.slice(0, len) });
        } else {
          this.push({ name: 'char', ch, ctrl: false, meta: true, shift: false, raw: b.slice(0, len) });
        }
        return len;
      }
    }

    // ---- 单字节控制符 ----
    const raw1 = b[0];
    if (c0 === 0x0d || c0 === 0x0a) {
      this.buf = b.slice(1);
      // 关键：粘贴突发里的换行要当成「字面换行」并入 paste，绝不能解释成 Enter 逐行提交。
      // 但也不能无脑吞掉所有回车——否则用户「敲完一行立刻回车」会被并进缓冲、导致消息发不出去。
      // 判定标准：当前突发已经含换行（说明正在多行粘贴中），或体量已达粘贴阈值（大段文本），
      // 这两种情况才把换行当字面内容；否则就是用户主动回车提交。
      const looksLikePaste = this.burst.includes('\n') || this.burst.length >= this.pasteThreshold;
      if (looksLikePaste) {
        this.pushChar('\n');
        return 1;
      }
      // Ctrl+J：很多终端把 Shift+Enter 映射成它
      this.push({ name: 'enter', ctrl: c0 === 0x0a, meta: false, shift: false, raw: raw1 });
      return 1;
    }
    if (c0 === 0x09) {
      this.buf = b.slice(1);
      this.push({ name: 'tab', ctrl: false, meta: false, shift: false, raw: raw1 });
      return 1;
    }
    if (c0 === 0x7f || c0 === 0x08) {
      this.buf = b.slice(1);
      this.push({ name: 'backspace', ctrl: c0 === 0x08, meta: false, shift: false, raw: raw1 });
      return 1;
    }
    if (c0 === 0x03) {
      this.buf = b.slice(1);
      this.push({ name: 'c', ctrl: true, meta: false, shift: false, raw: raw1 });
      return 1;
    }
    if (c0 < 0x20) {
      this.buf = b.slice(1);
      const name = CTRL_NAMES[c0];
      this.push({ name: name ?? 'unknown', ctrl: true, meta: false, shift: false, raw: raw1 });
      return 1;
    }

    // ---- 普通可见字符 ----
    const cp = b.codePointAt(0);
    const ch = cp === undefined ? b[0] : String.fromCodePoint(cp);
    this.buf = b.slice(ch.length);
    this.pushChar(ch);
    return ch.length;
  }

  private emitCsi(params: string, final: string, raw: string): void {
    const parts = params.split(';');
    const mod = parts.length > 1 ? parseInt(parts[1], 10) || 1 : 1;
    const { shift, meta, ctrl } = decodeModifier(mod);

    if (final === '~') {
      const name = CSI_TILDE[parts[0]] ?? 'unknown';
      this.push({ name, ctrl, meta, shift, raw });
      return;
    }
    if (final === 'Z') {
      this.push({ name: 'tab', ctrl: false, meta: false, shift: true, raw });
      return;
    }
    const name = SS3[final];
    if (name) {
      this.push({ name, ctrl, meta, shift, raw });
      return;
    }
    // 鼠标 / 其他：忽略但不要漏进输入框
    this.push({ name: 'unknown', ctrl, meta, shift, raw });
  }

  // ---- 孤立 ESC 处理 ----
  private escTimer: NodeJS.Timeout | null = null;
  private scheduleLoneEscape(): void {
    if (this.escTimer) return;
    this.escTimer = setTimeout(() => {
      this.escTimer = null;
      if (this.buf === '\x1b') {
        this.buf = '';
        this.push({ name: 'escape', ctrl: false, meta: false, shift: false, raw: '\x1b' });
      } else {
        this.drain();
      }
    }, 25);
    this.escTimer.unref?.();
  }

  // ---- 粘贴突发合并 ----
  /**
   * 逐字符按键会立刻发出；但如果短时间内涌入大量可见字符，
   * 合并成一次 paste 事件。这样 1000 字符的粘贴只触发 1 次重绘而不是 1000 次。
   */
  private pushChar(ch: string): void {
    this.burst += ch;
    if (this.burstTimer) clearTimeout(this.burstTimer);
    // 超过硬上限才强制切段，纯粹为了防内存爆掉；
    // 正常粘贴一律等定时器统一吐，避免一次粘贴被切成好几个 paste 事件
    if (this.burst.length >= BURST_HARD_CAP) {
      this.flushBurst();
      return;
    }
    this.burstTimer = setTimeout(() => this.flushBurst(), this.pasteWindowMs);
    this.burstTimer.unref?.();
  }

  /** 非字符按键必须先把已攒的字符吐出去，保持顺序 */
  private push(k: Key): void {
    this.flushBurst();
    this.emit('key', k);
  }

  private flushBurst(): void {
    if (this.burstTimer) {
      clearTimeout(this.burstTimer);
      this.burstTimer = null;
    }
    if (!this.burst) return;
    const text = this.burst;
    this.burst = '';
    if (text.length >= this.pasteThreshold) {
      this.emit('paste', { text });
      return;
    }
    for (const ch of text) {
      this.emit('key', { name: 'char', ch, ctrl: false, meta: false, shift: false, raw: ch });
    }
  }
}
