/**
 * 工具注册表
 */
import type { ToolContext, ToolDefinition, ToolSchema } from '../types/tool.js';
import { ToolError } from '../errors.js';
import type { ContentPart, ToolResult } from '../types/message.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register<T>(tool: ToolDefinition<T>): void {
    if (this.tools.has(tool.schema.name)) {
      throw new Error(`Tool ${tool.schema.name} already registered`);
    }
    this.tools.set(tool.schema.name, tool as unknown as ToolDefinition);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  async execute(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolError(`Tool not found: ${name}`, name);
    try {
      const r = await tool.execute(input, ctx);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        toolCallId: '',
        content: `Error: ${msg}`,
        isError: true,
      };
    }
  }
}