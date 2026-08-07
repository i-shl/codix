/**
 * Slash 命令注册表 + 分发
 *
 * 只负责「命令是什么、执行后产生什么效果」，
 * 具体怎么画浮层、怎么输出，交给 ui/app.ts。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import type { GlobalConfig, ModelConfig } from '../../core/dist/index.js';
import { t } from '../../core/dist/index.js';
import type { vokedContext } from './core.js';

// ============== 注册表 ==============

export interface SlashCommand {
  cmd: string;
  aliases?: string[];
  description: string;
  usage?: string;
  /** 补全时只补到 "/cmd "，不直接执行 —— 避免误触空参命令 */
  needsArgs?: boolean;
  hidden?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: 'help', aliases: ['?'], description: t('cmd.help.desc') },
  { cmd: 'model', description: t('cmd.model.desc'), usage: '/model [关键词]' },
  { cmd: 'new', aliases: ['session'], description: t('cmd.new.desc'), usage: '/new [标题]' },
  { cmd: 'resume', description: t('cmd.resume.desc'), usage: '/resume [id]' },
  { cmd: 'sessions', description: t('cmd.sessions.desc') },
  { cmd: 'cd', description: t('cmd.cd.desc'), usage: '/cd <dir>', needsArgs: true },
  { cmd: 'tools', description: t('cmd.tools.desc') },
  { cmd: 'mcp', description: t('cmd.mcp.desc') },
  { cmd: 'skills', description: t('cmd.skills.desc') },
  { cmd: 'install', description: t('cmd.install.desc'), usage: '/install <url|npm:|git:|local:>', needsArgs: true },
  { cmd: 'rules', description: t('cmd.rules.desc') },
  { cmd: 'config', description: t('cmd.config.desc'), usage: '/config [show|path]' },
  { cmd: 'connect', description: t('cmd.connect.desc'), usage: '/connect <provider>', needsArgs: true },
  { cmd: 'status', description: t('cmd.status.desc') },
  { cmd: 'clear', description: t('cmd.clear.desc') },
  { cmd: 'exit', aliases: ['quit', 'q'], description: t('cmd.exit.desc') },
];

const ALIAS_MAP: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of SLASH_COMMANDS) for (const a of c.aliases ?? []) m[a] = c.cmd;
  return m;
})();

export function canonicalCommandName(name: string): string {
  const lower = name.toLowerCase();
  return ALIAS_MAP[lower] ?? lower;
}

export function commandDisplayName(c: SlashCommand): string {
  return c.aliases?.length ? `${c.cmd} (${c.aliases.join(', ')})` : c.cmd;
}

export function findCommand(name: string): SlashCommand | undefined {
  const canon = canonicalCommandName(name);
  return SLASH_COMMANDS.find((c) => c.cmd === canon);
}

// ============== 历史持久化 ==============

const HISTORY_PATH = path.join(os.homedir(), '.voked', 'history');
const HISTORY_MAX = 500;

export function loadHistory(): string[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    const lines = readFileSync(HISTORY_PATH, 'utf8').split('\n').filter((l) => l.trim());
    const texts = lines.map((l) => {
      try {
        const o = JSON.parse(l) as { text?: string };
        return typeof o.text === 'string' ? o.text : l;
      } catch {
        return l;
      }
    });
    return texts.slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}

export function appendHistory(text: string): void {
  const t = text.trim();
  if (!t) return;
  try {
    mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    appendFileSync(HISTORY_PATH, JSON.stringify({ text: t, ts: Date.now() }) + '\n', 'utf8');
  } catch {
    /* 历史写不进去不该影响主流程 */
  }
}

// ============== 模型列表（按供应商分组） ==============

export interface ModelRow {
  key: string;
  model: string;
  providerId: string;
  providerLabel: string;
  isCurrent: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  openai: 'OpenAI Compatible',
  'openai-compatible': 'OpenAI Compatible',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
};

/** 和桌面端一致：一个供应商挂多个模型，没归属的落到「其他」 */
export function buildModelRows(config: GlobalConfig): ModelRow[] {
  const cur = config.defaultModel ?? '';
  const providers = config.providers ?? {};
  const rows: ModelRow[] = Object.entries(config.models).map(([key, raw]) => {
    const m = raw as ModelConfig;
    const pid = m.providerId ?? `type:${m.provider}`;
    const label = m.providerId
      ? (providers[m.providerId]?.label ?? m.providerId)
      : (TYPE_LABEL[m.provider] ?? m.provider);
    return { key, model: m.model, providerId: pid, providerLabel: label, isCurrent: key === cur };
  });
  rows.sort((a, b) =>
    a.providerLabel === b.providerLabel
      ? a.key.localeCompare(b.key)
      : a.providerLabel.localeCompare(b.providerLabel)
  );
  return rows;
}

// ============== 分发 ==============

export interface SlashContext {
  ctx: vokedContext;
  sessionId: string;
  setModel: (key: string) => Promise<string>;
  newSession: (title?: string) => Promise<string>;
  resumeSession: (id: string) => Promise<string>;
  switchProject: (dir: string) => Promise<string>;
  exit: () => void;
}

export type SlashModal = 'model' | 'session' | 'help' | 'connect';

export interface SlashResult {
  /** 输出到正文的普通消息 */
  message?: string;
  /** 输出到正文的错误 */
  error?: string;
  /** 打开某个浮层 */
  modal?: SlashModal;
  /** connect 浮层的具体类型 */
  connectKind?: 'provider' | 'mcp';
  /** 清屏 */
  clear?: boolean;
}

export async function handleSlash(line: string, sc: SlashContext): Promise<SlashResult> {
  const trimmed = line.trim();
  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  const cmd = canonicalCommandName(parts[0] ?? '');
  const rest = parts.slice(1);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'help':
      return { modal: 'help' };

    case 'exit':
      sc.exit();
      return {};

    case 'clear':
      return { clear: true };

    case 'model': {
      if (!arg) return { modal: 'model' };
      const rows = buildModelRows(sc.ctx.config);
      const exact = rows.find((r) => r.key === arg);
      if (exact) return { message: await sc.setModel(exact.key) };
      const idx = Number.parseInt(arg, 10);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= rows.length) {
        return { message: await sc.setModel(rows[idx - 1].key) };
      }
      const q = arg.toLowerCase();
      const hits = rows.filter(
        (r) => r.key.toLowerCase().includes(q) || r.model.toLowerCase().includes(q)
      );
      if (hits.length === 1) return { message: await sc.setModel(hits[0].key) };
      if (hits.length > 1) {
        return {
          message:
            t('model.matchCount', { n: hits.length }) + '\n' +
            hits.map((h, i) => `  ${i + 1}. ${h.key}  ${h.model}  [${h.providerLabel}]`).join('\n'),
        };
      }
      return { error: t('model.notFoundArg', { arg }) };
    }

    case 'new': {
      const title = arg || t('session.newTitle');
      const msg = await sc.newSession(title);
      return { message: msg };
    }

    case 'resume': {
      if (!arg) return { modal: 'session' };
      return { message: await sc.resumeSession(arg) };
    }

    case 'sessions': {
      const list = await sc.ctx.sessions.list();
      if (!list.length) return { message: t('session.empty') };
      const text = list
        .slice(0, 20)
        .map((s) => `  ${s.id.slice(0, 8)}  ${new Date(s.updatedAt).toLocaleString()}  ${s.title}`)
        .join('\n');
      return { message: t('session.listCount', { n: list.length }) + '\n' + text };
    }

    case 'cd': {
      if (!arg) return { message: t('session.currentDir', { dir: sc.ctx.cwd }) };
      try {
        const dir = await sc.switchProject(arg);
        return { message: t('session.switched', { dir }) };
      } catch (e) {
        return { error: t('session.cdFailed', { msg: (e as Error).message }) };
      }
    }

    case 'tools': {
      const list = sc.ctx.tools;
      const text = list.map((t) => `  ${t.schema.name}  ${t.schema.description}`).join('\n');
      return { message: t('tools.listTitle', { n: list.length }) + '\n' + text };
    }

    case 'mcp': {
      const list = sc.ctx.mcp.listServers();
      if (!list.length) return { message: t('mcp.none') };
      const text = list
        .map((s) => `  ${s.connected ? '✓' : '✗'} ${s.name}  ${t('mcp.toolCount', { n: s.tools.length })}${s.error ? `  ${s.error}` : ''}`)
        .join('\n');
      return { message: t('mcp.listTitle') + '\n' + text };
    }

    case 'skills': {
      const skills = await sc.ctx.skills.listSkills(sc.ctx.cwd);
      if (!skills.length) return { message: t('skills.none') };
      const text = skills
        .map((s) => `  ${s.enabled ? '✓' : '✗'} ${s.manifest.name}@${s.manifest.version}  ${s.manifest.description}`)
        .join('\n');
      return { message: t('skills.listTitle', { n: skills.length }) + '\n' + text };
    }

    case 'install': {
      if (!arg) return { error: t('install.usage') };
      try {
        const dest = await sc.ctx.skillInstaller.install(arg);
        return { message: t('install.done', { dest }) };
      } catch (e) {
        return { error: t('install.failed', { msg: (e as Error).message }) };
      }
    }

    case 'rules': {
      const p = path.join(os.homedir(), '.voked', 'rules.md');
      try {
        const txt = await fs.readFile(p, 'utf8');
        return { message: `${p}\n\n${txt}` };
      } catch {
        return { message: t('rules.notFound', { p }) };
      }
    }

    case 'config': {
      if (rest[0] === 'path') {
        return { message: t('config.path', { p: path.join(os.homedir(), '.voked', 'config.json') }) };
      }
      const safe = JSON.parse(JSON.stringify(sc.ctx.config)) as GlobalConfig;
      for (const m of Object.values(safe.models ?? {})) if (m.apiKey) m.apiKey = '***';
      for (const p of Object.values(safe.providers ?? {})) if (p.apiKey) p.apiKey = '***';
      return { message: '```json\n' + JSON.stringify(safe, null, 2) + '\n```' };
    }

    case 'connect': {
      const sub = (rest[0] ?? '').toLowerCase();
      if (sub === 'mcp') return { modal: 'connect', connectKind: 'mcp' };
      // provider 或空（空时默认当作 provider）
      if (sub === '' || sub === 'provider') return { modal: 'connect', connectKind: 'provider' };
      return { error: t('connect.usage') };
    }

    case 'status': {
      const c = sc.ctx;
      return {
        message: [
          `${t('status.dir')}    ${c.cwd}`,
          `${t('status.session')}    ${sc.sessionId.slice(0, 8)}`,
          `${t('status.model')}    ${c.model.config.model}`,
          `${t('status.tools')}    ${c.tools.length} ${t('status.unit')}`,
          `${t('status.mcp')}     ${c.mcp.listServers().filter((s) => s.connected).length} ${t('status.mcpConnected')}`,
        ].join('\n'),
      };
    }

    default:
      return { error: t('cmd.unknown', { cmd: parts[0] ?? '' }) };
  }
}

export function helpText(): string {
  const width = SLASH_COMMANDS.reduce((m, c) => Math.max(m, commandDisplayName(c).length), 0);
  const cmds = SLASH_COMMANDS.filter((c) => !c.hidden)
    .map((c) => `  /${commandDisplayName(c).padEnd(width)}  ${c.description}`)
    .join('\n');
  return [
    t('help.commands'),
    cmds,
    '',
    t('help.shortcuts'),
    `  Enter        ${t('help.send')}`,
    `  Alt+Enter    ${t('help.newline')}`,
    `  Alt+M        ${t('help.multilineMode')}`,
    `  /           ${t('help.cmdPalette')}`,
    `  ↑ / ↓        ${t('help.history')}`,
    `  Ctrl+C       ${t('help.ctrlC')}`,
    `  Ctrl+D       ${t('help.ctrlD')}`,
    `  Ctrl+L       ${t('help.ctrlL')}`,
    `  Ctrl+W       ${t('help.ctrlW')}`,
    `  Esc          ${t('help.esc')}`,
    `  !cmd         ${t('help.bang')}`,
  ].join('\n');
}
