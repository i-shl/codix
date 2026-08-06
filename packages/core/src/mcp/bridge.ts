/**
 * 把 MCP 服务器的工具包装成 ToolDefinition 注册到 ToolRegistry
 */
import { ToolRegistry } from '../tools/registry.js';
import type { McpManager } from './manager.js';
import type { ContentPart, ToolResult } from '../types/message.js';

export function registerMcpTools(registry: ToolRegistry, manager: McpManager, serverName: string, namespace?: string): void {
  void (async () => {
    const tools = await manager.listToolsDetailed(serverName).catch(() => []);
    for (const t of tools) {
      const finalName = namespace ? `${namespace}__${t.name}` : t.name;
      registry.register({
        schema: {
          name: finalName,
          description: `[MCP ${serverName}] ${t.description ?? t.name}`,
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        },
        source: { type: 'mcp', serverName },
        renderUse: (input: Record<string, unknown>) => `MCP[${serverName}].${t.name}(${JSON.stringify(input)})`,
        execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
          try {
            const r = await manager.callTool(serverName, t.name, input);
            const text = mcpContentToString(r.content);
            return { toolCallId: '', content: text, isError: r.isError };
          } catch (e) {
            return { toolCallId: '', content: `Error: ${(e as Error).message}`, isError: true };
          }
        },
      });
    }
  })();
}

function mcpContentToString(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  return content
    .map((item: any) => {
      if (item.type === 'text') return item.text;
      if (item.type === 'image') return `[image: ${item.mimeType ?? 'image'}]`;
      if (item.type === 'resource') return `[resource: ${item.resource?.uri ?? ''}]`;
      return JSON.stringify(item);
    })
    .join('\n');
}