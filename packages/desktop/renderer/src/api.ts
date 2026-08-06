/**
 * API 类型 - 与 electron/preload.ts 保持一致
 */

export type ProviderType =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic'
  | 'gemini'
  | 'openai';

export interface ProviderConfig {
  label?: string;
  type: ProviderType;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

export interface ModelConfig {
  provider: ProviderType;
  providerId?: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  maxOutputTokens?: number;
  contextWindow?: number;
  extra?: Record<string, unknown>;
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  autoConnect?: boolean;
}

export interface GlobalConfig {
  defaultModel?: string;
  providers?: Record<string, ProviderConfig>;
  models: Record<string, ModelConfig>;
  permissionRules?: unknown[];
  mcpServers: McpServerConfig[];
  [k: string]: unknown;
}

export interface DiscoveredModel {
  id: string;
  detail?: string;
}

export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  sample?: string;
}

export interface DefaultSkill {
  source: string;
  name: string;
  label: string;
  description: string;
}

export interface vokedAPI {
  openFolderDialog: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  openPath: (p: string) => Promise<void>;

  run: (args: { cwd: string; sessionId: string; userInput: unknown }) => Promise<{ ok: boolean }>;
  rerunTurn: (args: { cwd: string; sessionId: string; userMessageId: string; text?: string }) => Promise<{ ok: boolean }>;
  abort: () => Promise<{ ok: boolean }>;

  listSessions: (cwd: string) => Promise<unknown[]>;
  createSession: (opts: { cwd: string; title?: string }) => Promise<unknown>;
  loadSession: (id: string) => Promise<unknown>;
  deleteSession: (id: string) => Promise<void>;

  loadConfig: (cwd: string) => Promise<GlobalConfig>;
  loadGlobalConfig: () => Promise<GlobalConfig>;
  saveGlobalConfig: (cfg: unknown) => Promise<void>;

  listProviderModels: (provider: {
    type: ProviderType;
    apiKey?: string;
    baseURL?: string;
    headers?: Record<string, string>;
  }) => Promise<DiscoveredModel[]>;
  testModel: (args: { model: ModelConfig; providers?: Record<string, ProviderConfig> }) => Promise<ModelTestResult>;

  listSkills: (cwd: string) => Promise<unknown[]>;
  installSkill: (opts: { source: string; cwd?: string }) => Promise<string>;
  uninstallSkill: (opts: { name: string; cwd?: string }) => Promise<void>;
  defaultSkills: () => Promise<DefaultSkill[]>;

  listMcp: (cwd: string) => Promise<unknown[]>;

  readFile: (p: string, cwd: string) => Promise<string>;
  writeRules: (opts: { cwd: string; content: string; scope: 'global' | 'project' }) => Promise<string>;
  readRules: (opts: { cwd: string; scope: 'global' | 'project' }) => Promise<string>;

  homeDir: () => Promise<string>;

  onEvent: (cb: (e: unknown) => void) => () => void;
  onAsk: (cb: (req: unknown) => void) => () => void;
  respondAsk: (choice: 'allow' | 'deny' | 'allowAll') => void;
  onMenuCmd: (cb: (cmd: unknown) => void) => () => void;
}
