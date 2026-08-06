/**
 * TodoWrite - 让 Agent 维护 todo 列表（辅助规划）
 */
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';

export interface TodoItem {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
  activeForm?: string;
}

export interface TodoState {
  items: TodoItem[];
}

/** 全局可订阅的 todo 状态（每个 sessionId 一份） */
const store = new Map<string, TodoState>();

export function getTodos(sessionId: string): TodoItem[] {
  return store.get(sessionId)?.items ?? [];
}

export class TodoWriteTool extends BaseTool<{ items: TodoItem[] }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'TodoWrite',
    '更新任务列表（计划）。每次调用必须传入完整列表。会作为系统提示辅助 Agent 保持计划。',
    {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            content: { type: 'string' },
            activeForm: { type: 'string' },
          },
          required: ['status', 'content'],
        },
      },
    },
    ['items']
  );

  renderUse(input: { items: TodoItem[] }): string {
    return `TodoUpdate (${input.items.length} items)`;
  }

  async execute(input: { items: TodoItem[] }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    store.set(ctx.sessionId, { items: input.items });
    const summary = input.items
      .map((it) => `[${it.status === 'completed' ? 'x' : it.status === 'in_progress' ? '~' : ' '}] ${it.content}`)
      .join('\n');
    return { toolCallId: '', content: summary };
  }
}