#!/usr/bin/env node
/**
 * voked CLI 入口
 */
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import { loadGlobalConfig, saveGlobalConfig, SessionManager, setLang, resolveLang, t } from '../../core/dist/index.js';
import { cli } from './cli-args.js';
import { App } from './ui/app.js';

/** 版本号从 cli 的 package.json 读取，避免与发布版本脱节 */
const VERSION = (() => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** 在进入交互界面前确定界面语言：--lang > 环境变量 > 配置 > 默认(中文) */
function applyLanguage(): void {
  const env = process.env.voked_LANG || process.env.LANG || '';
  const envLang = /(^|[-_])en([-_]|$)/i.test(env) ? 'en' : undefined;
  void loadGlobalConfig()
    .then((cfg) => cfg.ui?.language)
    .catch(() => undefined)
    .then((cfgLang) => {
      setLang(resolveLang({ flag: cli.flags.lang, env: envLang, config: cfgLang }));
    });
}

async function initConfig(): Promise<void> {
  const dir = path.join(os.homedir(), '.voked');
  const file = path.join(dir, 'config.json');
  const exists = await fs.access(file).then(() => true).catch(() => false);
  if (exists) {
    const cfg = await loadGlobalConfig().catch(() => null);
    console.log(t('config.exists', { file }));
    console.log(t('config.defaultModel', { defaultModel: cfg?.defaultModel ?? t('config.notSet') }));
    console.log(t('config.models', { models: Object.keys(cfg?.models ?? {}).join(', ') || t('config.none') }));
    return;
  }
  await saveGlobalConfig({
    providers: {
      openai: {
        label: 'OpenAI',
        type: 'openai-compatible',
        apiKey: process.env.voked_API_KEY ?? '',
        baseURL: process.env.voked_BASE_URL,
      },
    },
    models: {
      default: {
        provider: 'openai-compatible',
        providerId: 'openai',
        model: process.env.voked_MODEL ?? 'gpt-4o',
      },
    },
    defaultModel: 'default',
    permissionRules: [],
    mcpServers: [],
  });
  console.log(t('config.created', { file }));
  console.log(t('config.apiKeyHint'));
}

async function listSessions(): Promise<void> {
  const sessions = await new SessionManager().list().catch(() => []);
  if (!sessions.length) {
    console.log(t('session.empty'));
    return;
  }
  for (const s of sessions) {
    console.log(`${s.id.slice(0, 8)}  ${new Date(s.updatedAt).toLocaleString()}  ${s.title}  ${s.cwd}`);
  }
}

async function main(): Promise<void> {
  // meow v13 仅在「只有 --help 一个参数」时才自动显示帮助（argv.length===1 守卫），
  // 组合用法（如 `voked --lang en --help`）会被跳过。这里显式兜底，保证任意顺序都能看到帮助。
  if (cli.flags.help) { cli.showHelp(0); return; }
  if (cli.flags.version) { cli.showVersion(); return; }
  if (cli.flags.config) return initConfig();
  if (cli.flags.list) return listSessions();

  applyLanguage();

  const cwd = cli.input[0] ? path.resolve(process.cwd(), cli.input[0]) : process.cwd();
  const ok = await fs.access(cwd).then(() => true).catch(() => false);
  if (!ok) {
    console.error(t('cli.dirNotExist', { cwd }));
    process.exit(1);
  }

  if (!process.stdin.isTTY && !process.env.voked_FORCE_TTY) {
    console.error(t('cli.needTTY'));
    process.exit(1);
  }

  const app = new App({
    cwd,
    version: VERSION,
    modelKey: cli.flags.model,
    resume: cli.flags.resume,
  });

  await app.run();
  process.exit(0);
}

main().catch((e: unknown) => {
  process.stdout.write('\x1b[?25h\n');
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
