/**
 * Electron 主进程 (CommonJS)
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');

let mainWindow: any = null;
let pendingAskResolver: ((choice: 'allow' | 'deny' | 'allowAll') => void) | null = null;
let currentAbort: (() => void) | null = null;
let currentCtx: any = null;

// dev 模式：用 NODE_ENV 或 explicit dev arg 判定
const isDev: boolean = process.env.voked_DEV === 'true' || process.argv.includes('--dev');

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'voked',
    backgroundColor: '#0f1115',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'dist-renderer', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu(): void {
  // voked 不在窗口顶部显示原生菜单栏 — UI 已自包含。
  // 仅保留一个空模板，避免 macOS 默认菜单出现。
  const template: any[] = [];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createWindow();
  buildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// =============== IPC ===============
ipcMain.handle('dialog:openFolder', async (): Promise<string | null> => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:openExternal', async (_e: any, url: string): Promise<void> => {
  await shell.openExternal(url);
});

ipcMain.handle('shell:openPath', async (_e: any, p: string): Promise<string> => {
  return shell.openPath(p);
});

// 强制 dynamic import (绕过 CJS 编译降级)
const esmImport = new Function('s', 'return import(s)') as <T = unknown>(s: string) => Promise<T>;
async function core(): Promise<any> {
  return await esmImport('@voked/core');
}

ipcMain.handle('voked:run', async (_e: any, args: { cwd: string; sessionId: string; userInput: any }): Promise<{ ok: boolean }> => {
  const { createAgentContext, runAgent } = await core();
  const ctx = await createAgentContext(args.cwd);
  currentCtx = ctx;
  const handle = runAgent(ctx, args.sessionId, args.userInput, {
    onEvent: (ev: any) => {
      if (!mainWindow) return;
      if (ev.type === 'text_delta') {
        mainWindow.webContents.send('voked:event', { type: 'text_delta', text: ev.text });
      } else if (ev.type === 'thinking_delta') {
        mainWindow.webContents.send('voked:event', { type: 'thinking_delta', text: ev.text });
      } else if (ev.type === 'tool_use_start') {
        mainWindow.webContents.send('voked:event', { type: 'tool_start', id: ev.id, name: ev.name });
      } else if (ev.type === 'tool_use_end') {
        mainWindow.webContents.send('voked:event', { type: 'tool_end', id: ev.id, input: ev.input });
      } else if (ev.type === 'finish') {
        mainWindow.webContents.send('voked:event', { type: 'finish', reason: ev.reason });
      }
    },
    onToolEnd: (call: any, res: any): void => {
      if (!mainWindow) return;
      mainWindow.webContents.send('voked:event', { type: 'tool_result', id: call.id, result: res });
    },
    onPermissionAsk: (req: any): Promise<'allow' | 'deny' | 'allowAll'> => {
      return new Promise((resolve) => {
        // 防止覆盖未处理的 resolver
        if (pendingAskResolver) {
          pendingAskResolver('deny');
          pendingAskResolver = null;
        }
        pendingAskResolver = resolve;
        mainWindow?.webContents.send('voked:ask', req);
      });
    },
  });
  currentAbort = handle.abort;
  try {
    await handle.promise;
  } finally {
    currentAbort = null;
    currentCtx = null;
  }
  return { ok: true };
});

ipcMain.handle('voked:rerunTurn', async (_e: any, args: { cwd: string; sessionId: string; userMessageId: string; text?: string }): Promise<{ ok: boolean }> => {
  const { createAgentContext, rerunTurn } = await core();
  const ctx = await createAgentContext(args.cwd);
  currentCtx = ctx;
  const handle = rerunTurn(ctx, args.sessionId, args.userMessageId, {
    onEvent: (ev: any) => {
      if (!mainWindow) return;
      if (ev.type === 'text_delta') {
        mainWindow.webContents.send('voked:event', { type: 'text_delta', text: ev.text });
      } else if (ev.type === 'thinking_delta') {
        mainWindow.webContents.send('voked:event', { type: 'thinking_delta', text: ev.text });
      } else if (ev.type === 'tool_use_start') {
        mainWindow.webContents.send('voked:event', { type: 'tool_start', id: ev.id, name: ev.name });
      } else if (ev.type === 'tool_use_end') {
        mainWindow.webContents.send('voked:event', { type: 'tool_end', id: ev.id, input: ev.input });
      } else if (ev.type === 'finish') {
        mainWindow.webContents.send('voked:event', { type: 'finish', reason: ev.reason });
      }
    },
    onToolEnd: (call: any, res: any): void => {
      if (!mainWindow) return;
      mainWindow.webContents.send('voked:event', { type: 'tool_result', id: call.id, result: res });
    },
    onPermissionAsk: (req: any): Promise<'allow' | 'deny' | 'allowAll'> => {
      return new Promise((resolve) => {
        if (pendingAskResolver) {
          pendingAskResolver('deny');
          pendingAskResolver = null;
        }
        pendingAskResolver = resolve;
        mainWindow?.webContents.send('voked:ask', req);
      });
    },
  }, args.text);
  currentAbort = handle.abort;
  try {
    await handle.promise;
  } finally {
    currentAbort = null;
    currentCtx = null;
  }
  return { ok: true };
});

ipcMain.handle('voked:abort', async (): Promise<{ ok: boolean }> => {
  if (currentAbort) currentAbort();
  return { ok: true };
});

ipcMain.handle('voked:listSessions', async (_e: any, cwd: string): Promise<any[]> => {
  const { SessionManager } = await core();
  return new SessionManager({ baseDir: path.join(cwd, '.voked', 'sessions') }).list();
});

ipcMain.handle('voked:createSession', async (_e: any, opts: { cwd: string; title?: string }): Promise<any> => {
  const { SessionManager } = await core();
  const sm = new SessionManager({ baseDir: path.join(opts.cwd, '.voked', 'sessions') });
  return await sm.create({ cwd: opts.cwd, title: opts.title, model: undefined });
});

ipcMain.handle('voked:loadSession', async (_e: any, id: string): Promise<any> => {
  const { SessionManager } = await core();
  return new SessionManager().load(id);
});

ipcMain.handle('voked:deleteSession', async (_e: any, id: string): Promise<void> => {
  const { SessionManager } = await core();
  await new SessionManager().delete(id);
});

ipcMain.handle('voked:loadConfig', async (_e: any, cwd: string): Promise<any> => {
  const { loadMergedConfig } = await core();
  return await loadMergedConfig(cwd);
});

ipcMain.handle('voked:loadGlobalConfig', async (): Promise<any> => {
  const { loadGlobalConfig } = await core();
  return await loadGlobalConfig();
});

ipcMain.handle('voked:saveGlobalConfig', async (_e: any, cfg: unknown): Promise<void> => {
  const { saveGlobalConfig } = await core();
  await saveGlobalConfig(cfg);
});

ipcMain.handle('voked:listProviderModels', async (_e: any, provider: { type: string; apiKey?: string; baseURL?: string; headers?: Record<string, string> }): Promise<any[]> => {
  const { listProviderModels } = await core();
  return await listProviderModels(provider);
});

ipcMain.handle('voked:testModel', async (_e: any, args: { model: any; providers?: any }): Promise<any> => {
  const { testModelConnectivity } = await core();
  return await testModelConnectivity(args.model, { providers: args.providers });
});

ipcMain.handle('voked:defaultSkills', async (): Promise<any[]> => {
  const { DEFAULT_SKILLS } = await core();
  return DEFAULT_SKILLS;
});

/** 构造一个不依赖模型配置的 SkillInstaller（createAgentContext 会因未配置模型而抛错） */
async function makeSkillInstaller(cwd: string): Promise<any> {
  const { loadMergedConfig, createBuiltinRegistry, SkillManager, SkillInstaller } = await core();
  const cfg = await loadMergedConfig(cwd);
  const reg = createBuiltinRegistry(cfg);
  const sm = new SkillManager(reg);
  return new SkillInstaller(sm, reg);
}

ipcMain.handle('voked:uninstallSkill', async (_e: any, opts: { name: string; cwd?: string }): Promise<void> => {
  const cwd = opts.cwd ?? process.cwd();
  const installer = await makeSkillInstaller(cwd);
  await installer.uninstall(opts.name, { cwd });
});

ipcMain.handle('voked:listSkills', async (_e: any, cwd: string): Promise<any[]> => {
  const { loadMergedConfig, createBuiltinRegistry, SkillManager } = await core();
  const cfg = await loadMergedConfig(cwd);
  const reg = createBuiltinRegistry(cfg);
  return await new SkillManager(reg).listSkills(cwd);
});

ipcMain.handle('voked:installSkill', async (_e: any, opts: { source: string; cwd?: string }): Promise<string> => {
  const cwd = opts.cwd ?? process.cwd();
  const installer = await makeSkillInstaller(cwd);
  return await installer.install(opts.source, { cwd });
});

ipcMain.handle('voked:listMcp', async (_e: any, cwd: string): Promise<any[]> => {
  const { loadMergedConfig, McpManager } = await core();
  const cfg = await loadMergedConfig(cwd);
  const mcp = new McpManager();
  const out: any[] = [];
  for (const s of cfg.mcpServers ?? []) {
    if (s.enabled === false) {
      out.push({ name: s.name, connected: false, error: '已禁用', tools: [], resources: [], prompts: [] });
      continue;
    }
    out.push(await mcp.connect(s));
  }
  await mcp.disconnectAll?.();
  return out;
});

ipcMain.handle('voked:readFile', async (_e: any, p: string, cwd: string): Promise<string> => {
  // 大小限制 5MB（防 DoS）
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) throw new Error('文件不存在');
  if (stat.size > 5 * 1024 * 1024) throw new Error('文件超过 5MB 限制');
  return await fs.readFile(abs, 'utf8');
});

ipcMain.handle('voked:writeRules', async (_e: any, opts: { cwd: string; content: string; scope: 'global' | 'project' }): Promise<string> => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const home = os.homedir();
  const target = opts.scope === 'global'
    ? path.join(home, '.voked', 'rules.md')
    : path.join(opts.cwd, '.voked', 'rules.md');
  // project scope：拒绝 cwd 越界
  if (opts.scope === 'project') {
    const absCwd = path.resolve(opts.cwd);
    const absTarget = path.resolve(target);
    const rel = path.relative(absCwd, absTarget);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('拒绝写入 cwd 之外的路径');
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, opts.content, 'utf8');
  return target;
});

ipcMain.handle('voked:readRules', async (_e: any, opts: { cwd: string; scope: 'global' | 'project' }): Promise<string> => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const target = opts.scope === 'global'
    ? path.join(os.homedir(), '.voked', 'rules.md')
    : path.join(opts.cwd, '.voked', 'rules.md');
  try {
    return await fs.readFile(target, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('voked:homeDir', async (): Promise<string> => {
  const os = require('node:os');
  return os.homedir();
});

// 权限询问响应
ipcMain.on('voked:ask-response', (_e: any, choice: 'allow' | 'deny' | 'allowAll') => {
  if (pendingAskResolver) {
    pendingAskResolver(choice);
    pendingAskResolver = null;
  }
});