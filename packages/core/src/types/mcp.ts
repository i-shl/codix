/**
 * MCP 配置类型
 */
export type McpTransport = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** sse / http */
  url?: string;
  headers?: Record<string, string>;
  /** 是否启用 */
  enabled?: boolean;
  /** 自动连接 */
  autoConnect?: boolean;
}

export interface McpServerStatus {
  name: string;
  connected: boolean;
  error?: string;
  tools: string[];
  resources: string[];
  prompts: string[];
}