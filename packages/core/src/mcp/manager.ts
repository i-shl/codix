/**
 * MCP 客户端 - 基于 @modelcontextprotocol/sdk
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpServerStatus } from '../types/mcp.js';
import { McpError } from '../errors.js';
import { getLogger } from '../logger.js';

const log = getLogger('mcp');

interface ConnectedServer {
  name: string;
  client: Client;
  config: McpServerConfig;
  status: McpServerStatus;
}

export class McpManager {
  private servers = new Map<string, ConnectedServer>();

  async connect(cfg: McpServerConfig): Promise<McpServerStatus> {
    if (cfg.enabled === false) {
      return { name: cfg.name, connected: false, error: 'disabled', tools: [], resources: [], prompts: [] };
    }
    if (this.servers.has(cfg.name)) {
      await this.disconnect(cfg.name);
    }
    const client = new Client({ name: 'codix', version: '0.1.0' }, { capabilities: {} });
    try {
      const transport = createTransport(cfg);
      await client.connect(transport);
      const [tools, resources, prompts] = await Promise.all([
        client.listTools().catch(() => ({ tools: [] })),
        client.listResources().catch(() => ({ resources: [] })),
        client.listPrompts().catch(() => ({ prompts: [] })),
      ]);
      const status: McpServerStatus = {
        name: cfg.name,
        connected: true,
        tools: (tools.tools ?? []).map((t: { name: string }) => t.name),
        resources: (resources.resources ?? []).map((r: { name: string }) => r.name),
        prompts: (prompts.prompts ?? []).map((p: { name: string }) => p.name),
      };
      this.servers.set(cfg.name, { name: cfg.name, client, config: cfg, status });
      log.info(`connected ${cfg.name}`, status);
      return status;
    } catch (e) {
      log.error(`failed to connect ${cfg.name}`, e);
      return { name: cfg.name, connected: false, error: (e as Error).message, tools: [], resources: [], prompts: [] };
    }
  }

  async disconnect(name: string): Promise<void> {
    const s = this.servers.get(name);
    if (!s) return;
    try {
      await s.client.close();
    } catch {}
    this.servers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    for (const n of Array.from(this.servers.keys())) await this.disconnect(n);
  }

  getServer(name: string): ConnectedServer | undefined {
    return this.servers.get(name);
  }

  listServers(): McpServerStatus[] {
    return Array.from(this.servers.values()).map((s) => s.status);
  }

  async listAllTools(): Promise<{ server: string; tools: { name: string; description?: string; inputSchema: unknown }[] }[]> {
    const out: { server: string; tools: { name: string; description?: string; inputSchema: unknown }[] }[] = [];
    for (const [name, s] of this.servers) {
      const tools = await this.listToolsDetailed(name);
      out.push({ server: name, tools });
    }
    return out;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: unknown; isError: boolean }> {
    const s = this.servers.get(serverName);
    if (!s) throw new McpError(`MCP server not connected: ${serverName}`, serverName);
    try {
      const result = await s.client.callTool({ name: toolName, arguments: args });
      const isError = Boolean((result as { isError?: boolean }).isError);
      return { content: (result as { content?: unknown }).content ?? result, isError };
    } catch (e) {
      throw new McpError(`MCP ${serverName}/${toolName} failed: ${(e as Error).message}`, serverName, e);
    }
  }

  async listToolsDetailed(serverName: string): Promise<{ name: string; description?: string; inputSchema: unknown }[]> {
    const s = this.servers.get(serverName);
    if (!s) return [];
    const r = await s.client.listTools().catch(() => ({ tools: [] }));
    return (r.tools ?? []).map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  }
}

/** 透传给 MCP stdio 子进程时禁用的 env key（防止项目 config 注入劫持） */
const MCP_FORBIDDEN_ENV_KEYS = new Set([
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_DEBUG',
  'PYTHONPATH', 'PYTHONSTARTUP',
  'RUBYOPT',
  'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS',
  'IFS',
]);

function createTransport(cfg: McpServerConfig) {
  if (cfg.transport === 'stdio') {
    if (!cfg.command) throw new McpError('stdio transport requires command', cfg.name);
    // 过滤 env 中的黑名单 key（保留 None，交给 SDK 用 process.env 兜底）
    const safeEnv: Record<string, string> | undefined = cfg.env
      ? Object.fromEntries(Object.entries(cfg.env).filter(([k]) => !MCP_FORBIDDEN_ENV_KEYS.has(k)))
      : undefined;
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: safeEnv,
      cwd: cfg.cwd,
      // 关键：把 MCP 子进程的 stderr 吞掉（"Secure MCP Filesystem Server running on stdio" 等启动日志都走这里）
      // 不影响 IPC：stdin/stdout 仍是 pipe
      stderr: 'ignore',
    } as never);
  }
  if (cfg.transport === 'sse') {
    if (!cfg.url) throw new McpError('sse transport requires url', cfg.name);
    return new SSEClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers }, eventSourceInit: { headers: cfg.headers as Record<string, never> } as never });
  }
  if (cfg.transport === 'http') {
    if (!cfg.url) throw new McpError('http transport requires url', cfg.name);
    return new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } });
  }
  throw new McpError(`Unknown transport: ${(cfg as McpServerConfig).transport}`, cfg.name);
}