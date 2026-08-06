/**
 * TUI 单元测试 —— 跑的是 dist 里的真实产物，不是 src
 *
 * node --experimental-strip-types test/tui.ts
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { strWidth, wrapPlain, wrapText, truncate, padEnd } from '../dist/tui/width.js';
import { stripAnsi, seq, detectCaps, makePalette } from '../dist/tui/ansi.js';
import { Editor } from '../dist/tui/editor.js';
import { KeyReader } from '../dist/tui/keys.js';
import { Screen } from '../dist/tui/screen.js';
import { makeTheme } from '../dist/tui/theme.js';
import { renderMarkdown } from '../dist/tui/markdown.js';
import { renderComposer } from '../dist/ui/composer.js';
import { renderOverlay, renderConfirm, filterItems } from '../dist/ui/overlay.js';
import {
  renderUser,
  renderAssistant,
  renderToolStart,
  renderToolEnd,
  renderTurnSummary,
  summarizeToolInput,
} from '../dist/ui/transcript.js';
import { buildModelRows, canonicalCommandName, findCommand, helpText } from '../dist/commands.js';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      await fn();
      passed++;
    } catch (e) {
      failures.push(`${name}: ${(e as Error).message}`);
    }
  };
  return run();
}

// ==================== width ====================

async function widthTests(): Promise<void> {
  await test('strWidth：ASCII / CJK / emoji / 零宽', () => {
    assert.equal(strWidth('abc'), 3);
    assert.equal(strWidth('中文'), 4);
    assert.equal(strWidth('中a文'), 5);
    assert.equal(strWidth('e\u0301'), 1); // e + 组合重音
    assert.equal(strWidth('\x1b[31mred\x1b[0m'), 3);
  });

  await test('wrapPlain：各段拼接必须等于原串', () => {
    const samples = [
      'hello world this is a long sentence that must wrap somewhere',
      '中文中文中文中文中文中文中文中文中文中文',
      'mix中英mix中英mix中英mix中英',
      '   leading and trailing   ',
      'nospacesatallinthisverylongtokenwhichmustbehardwrapped',
    ];
    for (const s of samples) {
      for (const w of [1, 3, 7, 10, 20]) {
        const segs = wrapPlain(s, w);
        assert.equal(segs.join(''), s, `w=${w} 拼接不等: ${JSON.stringify(segs)}`);
        for (const seg of segs) {
          assert.ok(strWidth(seg) <= w + 1, `w=${w} 段过宽: ${JSON.stringify(seg)}`);
        }
      }
    }
  });

  await test('truncate：不超宽且不切断 ANSI', () => {
    assert.equal(strWidth(truncate('abcdefghij', 5)), 5);
    assert.ok(strWidth(truncate('中文中文中文', 5)) <= 5);
    const t = truncate('\x1b[31mredredred\x1b[0m', 6);
    assert.ok(strWidth(t) <= 6);
    assert.ok(t.includes('\x1b['));
  });

  await test('wrapText：保留空行', () => {
    const lines = wrapText('a\n\nb', 10);
    assert.deepEqual(lines, ['a', '', 'b']);
  });

  await test('padEnd 按显示宽度补齐', () => {
    assert.equal(strWidth(padEnd('中', 6)), 6);
  });
}

// ==================== ansi ====================

async function ansiTests(): Promise<void> {
  await test('seq.up(0) 返回空串', () => {
    assert.equal(seq.up(0), '');
    assert.equal(seq.up(3), '\x1b[3A');
  });

  await test('绝不包含 alt-screen 序列', () => {
    const all = Object.values(seq).map((v) => (typeof v === 'string' ? v : v(1))).join('');
    assert.ok(!all.includes('?1049'), '出现了 alt-screen 开关');
    assert.ok(!all.includes('?1047'), '出现了 alt-screen 开关');
  });

  await test('stripAnsi 清干净', () => {
    assert.equal(stripAnsi('\x1b[1m\x1b[38;5;75mhi\x1b[0m'), 'hi');
  });

  await test('NO_COLOR 时调色板是恒等函数', () => {
    const caps = { isTTY: true, color: 0, unicode: true, sync: false, legacyConhost: false } as const;
    const p = makePalette(caps as never);
    assert.equal(p.red('x'), 'x');
    assert.equal(p.bold('x'), 'x');
  });

  await test('detectCaps 在非 TTY 下不上色', () => {
    const caps = detectCaps({ isTTY: false } as never);
    assert.equal(caps.color, 0);
  });
}

// ==================== editor ====================

async function editorTests(): Promise<void> {
  await test('插入 / 退格 / 码点边界', () => {
    const e = new Editor();
    e.insert('ab');
    e.insert('😀');
    assert.equal(e.text, 'ab😀');
    e.backspace();
    assert.equal(e.text, 'ab', 'emoji 应整体删除');
    e.left();
    e.insert('X');
    assert.equal(e.text, 'aXb');
  });

  await test('词删除 / 行首行尾删除', () => {
    const e = new Editor();
    e.setText('hello brave world');
    e.deleteWordBefore();
    assert.equal(e.text, 'hello brave ');
    e.setText('one two');
    e.home();
    e.killToLineEnd();
    assert.equal(e.text, '');
  });

  await test('多行上下移动保持列位置', () => {
    const e = new Editor();
    e.setText('abcdef\nxy\nlonger line');
    e.cursor = e.text.indexOf('longer') + 5; // 第三行第 5 列
    assert.equal(e.up(), true);
    assert.equal(e.text.slice(e.cursor, e.cursor + 1), '\n', '第二行只有 2 列，应停在行尾');
    assert.equal(e.up(), true);
    assert.equal(e.text[e.cursor], 'c');
    assert.equal(e.up(), false, '已在首行');
  });

  await test('layout：光标位置随折行正确', () => {
    const e = new Editor();
    e.setText('0123456789');
    e.cursor = 10;
    const { lines, pos } = e.layout(4);
    assert.deepEqual(lines, ['0123', '4567', '89']);
    assert.equal(pos.row, 2);
    assert.equal(pos.col, 2);
  });

  await test('layout：空文本光标在 0,0', () => {
    const e = new Editor();
    const { lines, pos } = e.layout(20);
    assert.deepEqual(lines, ['']);
    assert.deepEqual(pos, { row: 0, col: 0 });
  });

  await test('layout：换行符后另起一行', () => {
    const e = new Editor();
    e.setText('ab\ncd');
    e.cursor = 4; // 'd' 之前
    const { lines, pos } = e.layout(20);
    assert.deepEqual(lines, ['ab', 'cd']);
    assert.equal(pos.row, 1);
    assert.equal(pos.col, 1);
  });

  await test('layout：CJK 列宽算 2', () => {
    const e = new Editor();
    e.setText('中文ab');
    e.cursor = 2;
    const { pos } = e.layout(20);
    assert.equal(pos.col, 4);
  });

  await test('历史：上翻下翻回到草稿', () => {
    const e = new Editor();
    e.setHistory(['first', 'second']);
    e.setText('draft');
    e.historyPrev();
    assert.equal(e.text, 'second');
    e.historyPrev();
    assert.equal(e.text, 'first');
    e.historyNext();
    assert.equal(e.text, 'second');
    e.historyNext();
    assert.equal(e.text, 'draft');
  });
}

// ==================== keys ====================

class FakeStdin extends EventEmitter {
  isTTY = false;
  setEncoding(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  setRawMode(): this {
    return this;
  }
}

async function keyTests(): Promise<void> {
  /** 喂完后等一个突发窗口，让攒着的可见字符吐出来 */
  const collect = async (
    feed: (r: InstanceType<typeof KeyReader>) => void,
    opts: Record<string, unknown> = {}
  ) => {
    const r = new KeyReader(new FakeStdin() as never, { pasteWindowMs: 1, pasteThreshold: 24, ...opts });
    const keys: Array<Record<string, unknown>> = [];
    const pastes: string[] = [];
    r.on('key', (k) => keys.push(k as never));
    r.on('paste', (p) => pastes.push(p.text));
    feed(r);
    await new Promise((res) => setTimeout(res, 12));
    return { keys, pastes };
  };

  await test('方向键 / Home / End / Delete', async () => {
    const { keys } = await collect((r) => r.feed('\x1b[A\x1b[B\x1b[C\x1b[D\x1b[H\x1b[F\x1b[3~'));
    assert.deepEqual(
      keys.map((k) => k.name),
      ['up', 'down', 'right', 'left', 'home', 'end', 'delete']
    );
  });

  await test('修饰键解码（Ctrl+Right / Shift+Tab）', async () => {
    const { keys } = await collect((r) => r.feed('\x1b[1;5C\x1b[Z'));
    assert.equal(keys[0].name, 'right');
    assert.equal(keys[0].ctrl, true);
    assert.equal(keys[1].name, 'tab');
    assert.equal(keys[1].shift, true);
  });

  await test('Ctrl 组合键', async () => {
    const { keys } = await collect((r) => r.feed('\x03\x17\x15\x0b\x0c'));
    assert.deepEqual(
      keys.map((k) => `${k.ctrl ? 'C-' : ''}${k.name}`),
      ['C-c', 'C-w', 'C-u', 'C-k', 'C-l']
    );
  });

  await test('Alt+字符 / Alt+Enter', async () => {
    const { keys } = await collect((r) => r.feed('\x1bm\x1b\r'));
    assert.equal(keys[0].name, 'char');
    assert.equal(keys[0].ch, 'm');
    assert.equal(keys[0].meta, true);
    assert.equal(keys[1].name, 'enter');
    assert.equal(keys[1].meta, true);
  });

  await test('bracketed paste 合并成一次 paste', async () => {
    const { keys, pastes } = await collect((r) => r.feed('\x1b[200~line1\nline2\x1b[201~'));
    assert.deepEqual(pastes, ['line1\nline2']);
    assert.equal(keys.length, 0);
  });

  await test('bracketed paste 跨 chunk', async () => {
    const { pastes } = await collect((r) => {
      r.feed('\x1b[200~part');
      r.feed('ial pas');
      r.feed('te\x1b[201~');
    });
    assert.deepEqual(pastes, ['partial paste']);
  });

  await test('突发合并：大量字符合成一次 paste，不切段', async () => {
    const { keys, pastes } = await collect((r) => r.feed('x'.repeat(400)));
    assert.equal(pastes.length, 1, `期望 1 次 paste，实际 ${pastes.length}`);
    assert.equal(pastes[0].length, 400);
    assert.equal(keys.length, 0);
  });

  await test('少量字符仍然逐键触发', async () => {
    const { keys, pastes } = await collect((r) => r.feed('abc'));
    assert.equal(pastes.length, 0);
    assert.deepEqual(keys.map((k) => k.ch), ['a', 'b', 'c']);
  });

  await test('突发中夹控制键时顺序不乱', async () => {
    const { keys } = await collect((r) => {
      r.feed('ab');
      r.feed('\x1b[A');
      r.feed('cd');
    });
    assert.deepEqual(keys.map((k) => k.ch ?? k.name), ['a', 'b', 'up', 'c', 'd']);
  });

  await test('CSI 序列跨 chunk 不丢键', async () => {
    const { keys } = await collect((r) => {
      r.feed('\x1b');
      r.feed('[');
      r.feed('A');
    });
    assert.deepEqual(keys.map((k) => k.name), ['up']);
  });

  await test('UTF-8 中文正常成键', async () => {
    const { keys } = await collect((r) => r.feed('中'));
    assert.equal(keys[0].name, 'char');
    assert.equal(keys[0].ch, '中');
  });
}

// ==================== screen ====================

class FakeOut {
  columns = 40;
  rows = 20;
  isTTY = true;
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
  reset(): void {
    this.chunks = [];
  }
  on(): this {
    return this;
  }
  off(): this {
    return this;
  }
}

function mkScreen(out: FakeOut): InstanceType<typeof Screen> {
  return new Screen({
    out: out as never,
    caps: { isTTY: true, color: 16, unicode: true, sync: false, legacyConhost: false } as never,
    frameMs: 0,
  });
}

async function screenTests(): Promise<void> {
  await test('首帧：footer 写出并停在 park line', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['aaa', 'bbb']);
    s.flushNow();
    const t = out.text;
    assert.ok(t.includes('aaa'), '缺少 footer 内容');
    assert.ok(t.includes('bbb'));
    assert.ok(!t.includes('?1049'), '不该进 alt-screen');
    assert.ok(!t.includes('\x1b[2J'), '不该整屏清除');
  });

  await test('内容没变时空帧输出 0 字节', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['same']);
    s.flushNow();
    out.reset();
    s.setFooter(['same']);
    s.flushNow();
    s.flushNow();
    assert.equal(out.text, '', `空帧仍有输出: ${JSON.stringify(out.text)}`);
  });

  await test('重绘时先上移到 footer 顶部', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['1', '2', '3']);
    s.flushNow();
    out.reset();
    s.setFooter(['1', '2', 'X']);
    s.flushNow();
    assert.ok(out.text.startsWith('\x1b[?25l\x1b[3A\r'), `实际: ${JSON.stringify(out.text.slice(0, 24))}`);
  });

  await test('footer 变短时用 CSI J 清残留', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['1', '2', '3', '4']);
    s.flushNow();
    out.reset();
    s.setFooter(['1']);
    s.flushNow();
    assert.ok(out.text.includes('\x1b[J'), '缺少 CSI J');
  });

  await test('footer 每行都被截断到 innerWidth', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['x'.repeat(200)]);
    s.flushNow();
    const line = out.text.split('\n').find((l) => l.includes('x'))!;
    assert.ok(strWidth(stripAnsi(line)) <= s.innerWidth + 2, `行太宽: ${strWidth(stripAnsi(line))}`);
  });

  await test('正文追加在 footer 上方，顺序不乱', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['FOOTER']);
    s.flushNow();
    out.reset();
    s.writeBody(['body-1', 'body-2']);
    s.flushNow();
    const t = stripAnsi(out.text);
    assert.ok(t.indexOf('body-1') < t.indexOf('body-2'));
    assert.ok(t.indexOf('body-2') < t.indexOf('FOOTER'), 'footer 应在正文之后重绘');
  });

  await test('光标定位：上移到目标行并右移列', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['a', 'b', 'c'], { row: 1, col: 4 });
    s.flushNow();
    assert.ok(out.text.includes('\x1b[2A\r\x1b[4C'), `实际尾部: ${JSON.stringify(out.text.slice(-30))}`);
    assert.ok(out.text.trimEnd().endsWith('\x1b[?25h'), '结尾应恢复光标');
  });

  await test('close() 清掉 footer 并恢复光标', () => {
    const out = new FakeOut();
    const s = mkScreen(out);
    s.setFooter(['x', 'y']);
    s.flushNow();
    out.reset();
    s.close();
    assert.ok(out.text.includes('\x1b[2A'));
    assert.ok(out.text.includes('\x1b[J'));
    assert.ok(out.text.includes('\x1b[?25h'));
  });

  await test('sync 能力打开时整帧被 2026 包裹', () => {
    const out = new FakeOut();
    const s = new Screen({
      out: out as never,
      caps: { isTTY: true, color: 16, unicode: true, sync: true, legacyConhost: false } as never,
      frameMs: 0,
    });
    s.setFooter(['z']);
    s.flushNow();
    assert.ok(out.text.startsWith('\x1b[?2026h'));
    assert.ok(out.text.endsWith('\x1b[?2026l'));
  });

  await test('大量 setFooter 只画一帧（合并刷新）', async () => {
    const out = new FakeOut();
    const s = new Screen({
      out: out as never,
      caps: { isTTY: true, color: 16, unicode: true, sync: false, legacyConhost: false } as never,
      frameMs: 5,
    });
    for (let i = 0; i < 500; i++) s.setFooter([`tick ${i}`]);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(out.chunks.length, 1, `期望 1 帧，实际 ${out.chunks.length} 帧`);
    assert.ok(out.text.includes('tick 499'), '应画最后一次状态');
  });
}

// ==================== 渲染组件 ====================

const CAPS_UNI = { isTTY: true, color: 256, unicode: true, sync: true, legacyConhost: false } as const;
const CAPS_ASCII = { isTTY: true, color: 16, unicode: false, sync: false, legacyConhost: true } as const;

async function renderTests(): Promise<void> {
  const t = makeTheme(CAPS_UNI as never);
  const tAscii = makeTheme(CAPS_ASCII as never);

  await test('markdown：标题 / 列表 / 代码块 / 表格都不炸', () => {
    const src = [
      '# 标题',
      '',
      '普通段落 **粗体** `代码` [链接](https://x.dev)',
      '',
      '- 一',
      '- 二',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '| 列A | 列B |',
      '| :-- | --: |',
      '| 中文 | 2 |',
      '',
      '> 引用',
      '',
      '---',
    ].join('\n');
    const lines = renderMarkdown(src, t, 60);
    assert.ok(lines.length > 8);
    for (const l of lines) assert.ok(strWidth(l) <= 80, `行过宽: ${strWidth(l)} ${JSON.stringify(stripAnsi(l))}`);
    const plain = lines.map(stripAnsi).join('\n');
    assert.ok(plain.includes('标题'));
    assert.ok(plain.includes('const a = 1;'));
    assert.ok(plain.includes('列A'));
  });

  await test('markdown：空串返回空数组', () => {
    assert.deepEqual(renderMarkdown('   ', t, 40), []);
  });

  await test('legacy conhost 用 ASCII 字形，不吐 Unicode 框线', () => {
    const lines = renderMarkdown('```\nx\n```', tAscii, 40);
    const plain = lines.map(stripAnsi).join('');
    assert.ok(!/[╭╮╰╯─│●✓✗⎿]/.test(plain), `出现了 Unicode 字形: ${plain}`);
  });

  await test('composer：行数 = above + 边框 + 文本行 + 状态行', () => {
    const e = new Editor();
    e.setText('hello');
    const f = renderComposer({
      editor: e,
      theme: t,
      width: 40,
      placeholder: 'ph',
      above: ['A', 'B'],
      hint: 'hint',
      status: 'st',
      dimmed: false,
      focused: true,
      multiline: false,
    });
    assert.equal(f.lines.length, 2 + 1 + 1 + 1 + 1);
    assert.ok(f.cursor);
    assert.equal(f.cursor!.row, 3, 'above(2) + 顶框(1) = 第 3 行');
    assert.equal(f.cursor!.col, 4 + strWidth('hello'));
  });

  await test('composer：占位符不影响光标列', () => {
    const f = renderComposer({
      editor: new Editor(),
      theme: t,
      width: 40,
      placeholder: '问点什么',
      above: [],
      hint: '',
      status: '',
      dimmed: false,
      focused: true,
      multiline: false,
    });
    assert.equal(f.cursor!.col, 4);
    assert.ok(stripAnsi(f.lines[1]).includes('问点什么'));
  });

  await test('composer：长文本折行后每行宽度受控', () => {
    const e = new Editor();
    e.setText('中文'.repeat(80));
    const f = renderComposer({
      editor: e,
      theme: t,
      width: 40,
      placeholder: '',
      above: [],
      hint: 'h',
      status: 's',
      dimmed: false,
      focused: true,
      multiline: false,
    });
    for (const l of f.lines) assert.ok(strWidth(l) <= 42, `行宽 ${strWidth(l)}`);
    assert.ok(f.cursor!.row > 1, '光标应落在折行之后');
  });

  await test('composer：失焦时不返回光标', () => {
    const f = renderComposer({
      editor: new Editor(),
      theme: t,
      width: 30,
      placeholder: '',
      above: [],
      hint: '',
      status: '',
      dimmed: true,
      focused: false,
      multiline: false,
    });
    assert.equal(f.cursor, null);
  });

  await test('overlay：分组标题 + 选中标记 + 溢出提示', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      value: `m${i}`,
      label: `model-${i}`,
      hint: 'gpt',
      group: i < 15 ? 'OpenAI' : 'Anthropic',
      marked: i === 20,
    }));
    const lines = renderOverlay(
      { kind: 'models', title: '选择模型', items, index: 20, filter: '', ownFilter: true, onPick: () => undefined },
      t,
      50
    );
    const plain = lines.map(stripAnsi).join('\n');
    assert.ok(plain.includes('Anthropic'), '缺少分组标题');
    assert.ok(plain.includes('model-20'));
    assert.ok(plain.includes('还有'), '缺少溢出提示');
    for (const l of lines) assert.ok(strWidth(l) <= 60, `overlay 行过宽 ${strWidth(l)}`);
  });

  await test('overlay：空结果有提示', () => {
    const lines = renderOverlay(
      { kind: 'models', title: 'x', items: [], index: 0, filter: 'zzz', ownFilter: true, onPick: () => undefined },
      t,
      40
    );
    assert.ok(lines.map(stripAnsi).join('').includes('无匹配'));
  });

  await test('filterItems 命中 label / hint / group', () => {
    const items = [
      { value: 'a', label: 'Alpha', hint: 'first', group: 'G1' },
      { value: 'b', label: 'Beta', hint: 'second', group: 'G2' },
    ];
    assert.equal(filterItems(items, 'alp').length, 1);
    assert.equal(filterItems(items, 'second').length, 1);
    assert.equal(filterItems(items, 'g2').length, 1);
    assert.equal(filterItems(items, '').length, 2);
  });

  await test('confirm 面板包含全部选项', () => {
    const lines = renderConfirm(
      {
        title: '需要授权：Bash',
        detail: ['rm -rf /tmp/x'],
        options: [
          { value: 'allow', label: '允许这一次' },
          { value: 'allowAll', label: '始终允许' },
          { value: 'deny', label: '拒绝' },
        ],
        index: 1,
      },
      t,
      50
    );
    const plain = lines.map(stripAnsi).join('\n');
    assert.ok(plain.includes('允许这一次'));
    assert.ok(plain.includes('始终允许'));
    assert.ok(plain.includes('拒绝'));
    assert.ok(plain.includes('rm -rf /tmp/x'));
  });

  await test('transcript：用户 / AI / 工具渲染', () => {
    const u = renderUser('你好', t, 60);
    assert.ok(u.map(stripAnsi).join('').includes('你好'));

    const a = renderAssistant('# H\n\n正文', t, 60);
    assert.ok(a.map(stripAnsi).join('\n').includes('正文'));

    const call = { id: '1', name: 'Read', input: { file_path: '/a/b.ts' } };
    const s = renderToolStart(call, t, 60);
    assert.ok(s.map(stripAnsi).join('').includes('Read'));
    assert.ok(s.map(stripAnsi).join('').includes('/a/b.ts'));

    const eLines = renderToolEnd(call, { toolCallId: '1', content: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8' }, t, 60, 3);
    const plain = eLines.map(stripAnsi).join('\n');
    assert.ok(plain.includes('l1'));
    assert.ok(plain.includes('另有 5 行'));
  });

  await test('transcript：工具出错标红且不越界', () => {
    const call = { id: '1', name: 'Bash', input: { command: 'x'.repeat(500) } };
    const s = renderToolStart(call, t, 40);
    for (const l of s) assert.ok(strWidth(l) <= 42, `工具行过宽 ${strWidth(l)}`);
    const e = renderToolEnd(call, { toolCallId: '1', content: 'boom', isError: true }, t, 40);
    assert.ok(e.join('').includes('\x1b['));
  });

  await test('summarizeToolInput 挑主字段', () => {
    assert.equal(summarizeToolInput('Read', { file_path: '/x' }), '/x');
    assert.equal(summarizeToolInput('Bash', { command: 'ls  -la' }), 'ls -la');
    assert.equal(summarizeToolInput('X', {}), '');
  });

  await test('回合总结包含耗时与 token', () => {
    const lines = renderTurnSummary({ ms: 12340, input: 1500, output: 300, tools: 2 }, t);
    const plain = lines.map(stripAnsi).join('');
    assert.ok(plain.includes('12.3s'));
    assert.ok(plain.includes('1.5k'));
    assert.ok(plain.includes('2 次工具'));
  });
}

// ==================== commands ====================

async function commandTests(): Promise<void> {
  await test('别名解析', () => {
    assert.equal(canonicalCommandName('new'), 'new');
    assert.equal(canonicalCommandName('session'), 'new');
    assert.equal(canonicalCommandName('q'), 'exit');
    assert.equal(canonicalCommandName('quit'), 'exit');
  });

  await test('needsArgs 的命令能查到', () => {
    assert.equal(findCommand('cd')?.needsArgs, true);
    assert.equal(findCommand('help')?.needsArgs, undefined);
  });

  await test('buildModelRows 按供应商分组并标记当前项', () => {
    const cfg = {
      defaultModel: 'fast',
      providers: {
        ds: { label: 'DeepSeek', type: 'openai-compatible' },
        oa: { label: 'OpenAI', type: 'openai' },
      },
      models: {
        fast: { provider: 'openai-compatible', providerId: 'ds', model: 'deepseek-chat' },
        smart: { provider: 'openai', providerId: 'oa', model: 'gpt-4o' },
        legacy: { provider: 'anthropic', model: 'claude-3' },
      },
      permissionRules: [],
      mcpServers: [],
    };
    const rows = buildModelRows(cfg as never);
    assert.equal(rows.length, 3);
    assert.equal(rows.find((r) => r.key === 'fast')!.providerLabel, 'DeepSeek');
    assert.equal(rows.find((r) => r.key === 'fast')!.isCurrent, true);
    assert.equal(rows.find((r) => r.key === 'legacy')!.providerLabel, 'Anthropic');
    // 同一供应商的模型必须相邻
    const labels = rows.map((r) => r.providerLabel);
    assert.deepEqual(labels, [...labels].sort());
  });

  await test('helpText 覆盖所有命令与关键快捷键', () => {
    const h = helpText();
    assert.ok(h.includes('/model'));
    assert.ok(h.includes('Alt+Enter'));
    assert.ok(h.includes('Ctrl+C'));
  });
}

// ==================== run ====================

async function main(): Promise<void> {
  await widthTests();
  await ansiTests();
  await editorTests();
  await keyTests();
  await screenTests();
  await renderTests();
  await commandTests();

  if (failures.length) {
    console.error(`\n✗ ${failures.length} 个用例失败：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`✓ TUI 测试全部通过（${passed} 个用例）`);
}

void main();
