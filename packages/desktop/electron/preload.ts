/**
 * Electron preload (CommonJS)
 */
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (p: string) => ipcRenderer.invoke('shell:openPath', p),

  run: (args: { cwd: string; sessionId: string; userInput: unknown }) => ipcRenderer.invoke('voked:run', args),
  rerunTurn: (args: { cwd: string; sessionId: string; userMessageId: string; text?: string }) => ipcRenderer.invoke('voked:rerunTurn', args),
  abort: () => ipcRenderer.invoke('voked:abort'),

  listSessions: (cwd: string) => ipcRenderer.invoke('voked:listSessions', cwd),
  createSession: (opts: { cwd: string; title?: string }) => ipcRenderer.invoke('voked:createSession', opts),
  loadSession: (id: string) => ipcRenderer.invoke('voked:loadSession', id),
  deleteSession: (id: string) => ipcRenderer.invoke('voked:deleteSession', id),

  loadConfig: (cwd: string) => ipcRenderer.invoke('voked:loadConfig', cwd),
  loadGlobalConfig: () => ipcRenderer.invoke('voked:loadGlobalConfig'),
  saveGlobalConfig: (cfg: unknown) => ipcRenderer.invoke('voked:saveGlobalConfig', cfg),

  listProviderModels: (provider: { type: string; apiKey?: string; baseURL?: string; headers?: Record<string, string> }) =>
    ipcRenderer.invoke('voked:listProviderModels', provider),
  testModel: (args: { model: unknown; providers?: unknown }) => ipcRenderer.invoke('voked:testModel', args),

  listSkills: (cwd: string) => ipcRenderer.invoke('voked:listSkills', cwd),
  installSkill: (opts: { source: string; cwd?: string }) => ipcRenderer.invoke('voked:installSkill', opts),
  uninstallSkill: (opts: { name: string; cwd?: string }) => ipcRenderer.invoke('voked:uninstallSkill', opts),
  defaultSkills: () => ipcRenderer.invoke('voked:defaultSkills'),

  listMcp: (cwd: string) => ipcRenderer.invoke('voked:listMcp', cwd),

  readFile: (p: string, cwd: string) => ipcRenderer.invoke('voked:readFile', p, cwd),
  writeRules: (opts: { cwd: string; content: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('voked:writeRules', opts),
  readRules: (opts: { cwd: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('voked:readRules', opts),

  homeDir: () => ipcRenderer.invoke('voked:homeDir'),

  onEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, data: unknown): void => cb(data);
    ipcRenderer.on('voked:event', handler);
    return () => ipcRenderer.off('voked:event', handler);
  },

  onAsk: (cb: (req: unknown) => void) => {
    const handler = (_e: unknown, req: unknown): void => cb(req);
    ipcRenderer.on('voked:ask', handler);
    return () => ipcRenderer.off('voked:ask', handler);
  },

  respondAsk: (choice: 'allow' | 'deny' | 'allowAll'): void => {
    ipcRenderer.send('voked:ask-response', choice);
  },

  onMenuCmd: (cb: (cmd: unknown) => void) => {
    const handler = (_e: unknown, cmd: unknown): void => cb(cmd);
    ipcRenderer.on('cmd', handler);
    return () => ipcRenderer.off('cmd', handler);
  },
};

contextBridge.exposeInMainWorld('voked', api);