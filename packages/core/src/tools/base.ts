/**
 * 工具基类
 */
import type { ToolContext, ToolDefinition, ToolSchema } from '../types/tool.js';

export abstract class BaseTool<TInput = Record<string, unknown>> implements ToolDefinition<TInput> {
  abstract readonly schema: ToolSchema;
  abstract readonly source: ToolDefinition['source'];
  abstract execute(input: TInput, ctx: ToolContext): Promise<import('../types/message.js').ToolResult>;

  renderUse(input: TInput): string {
    return JSON.stringify(input);
  }

  renderResult(result: import('../types/message.js').ToolResult): string {
    if (typeof result.content === 'string') return result.content;
    return result.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
  }
}

export function jsonSchema(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolSchema {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}