/**
 * Electron preload (CommonJS)
 */
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),

  run: (args: { cwd: string; sessionId: string; userInput: unknown }) => ipcRenderer.invoke('codix:run', args),
  rerunTurn: (args: { cwd: string; sessionId: string; userMessageId: string; text?: string }) => ipcRenderer.invoke('codix:rerunTurn', args),
  abort: () => ipcRenderer.invoke('codix:abort'),

  listSessions: (cwd: string) => ipcRenderer.invoke('codix:listSessions', cwd),
  createSession: (opts: { cwd: string; title?: string }) => ipcRenderer.invoke('codix:createSession', opts),
  loadSession: (id: string) => ipcRenderer.invoke('codix:loadSession', id),
  deleteSession: (id: string) => ipcRenderer.invoke('codix:deleteSession', id),

  loadConfig: (cwd: string) => ipcRenderer.invoke('codix:loadConfig', cwd),
  loadGlobalConfig: () => ipcRenderer.invoke('codix:loadGlobalConfig'),
  saveGlobalConfig: (cfg: unknown) => ipcRenderer.invoke('codix:saveGlobalConfig', cfg),

  listProviderModels: (provider: { type: string; apiKey?: string; baseURL?: string; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('codix:listProviderModels', provider),
  testModel: (args: { model: unknown; providers?: unknown }) => ipcRenderer.invoke('codix:testModel', args),

  listSkills: (cwd: string) => ipcRenderer.invoke('codix:listSkills', cwd),
  installSkill: (opts: { source: string; cwd?: string }) => ipcRenderer.invoke('codix:installSkill', opts),
  uninstallSkill: (opts: { name: string; cwd?: string }) => ipcRenderer.invoke('codix:uninstallSkill', opts),
  defaultSkills: () => ipcRenderer.invoke('codix:defaultSkills'),

  listMcp: (cwd: string) => ipcRenderer.invoke('codix:listMcp', cwd),

  readFile: (p: string, cwd: string) => ipcRenderer.invoke('codix:readFile', p, cwd),
  writeRules: (opts: { cwd: string; content: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('codix:writeRules', opts),
  readRules: (opts: { cwd: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('codix:readRules', opts),

  homeDir: () => ipcRenderer.invoke('codix:homeDir'),

  onEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, data: unknown): void => cb(data);
    ipcRenderer.on('codix:event', handler);
    return () => ipcRenderer.off('codix:event', handler);
  },

  onAsk: (cb: (req: unknown) => void) => {
    const handler = (_e: unknown, req: unknown): void => cb(req);
    ipcRenderer.on('codix:ask', handler);
    return () => ipcRenderer.off('codix:ask', handler);
  },

  respondAsk: (choice: 'allow' | 'deny' | 'allowAll'): void => {
    ipcRenderer.send('codix:ask-response', choice);
  },

  onMenuCmd: (cb: (cmd: unknown) => void) => {
    const handler = (_e: unknown, cmd: unknown): void => cb(cmd);
    ipcRenderer.on('cmd', handler);
    return () => ipcRenderer.off('cmd', handler);
  },
};

contextBridge.exposeInMainWorld('codix', api);