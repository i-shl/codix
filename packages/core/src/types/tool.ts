/**
 * 工具类型 - 统一所有工具（内置 / MCP / Skill）的接口
 */
import type { ContentPart, ToolResult } from './message.js';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export type ToolSource =
  | { type: 'builtin' }
  | { type: 'mcp'; serverName: string }
  | { type: 'skill'; skillName: string };

export interface ToolContext {
  /** 当前工作目录（项目根） */
  cwd: string;
  /** 当前会话 id */
  sessionId: string;
  /** 工具权限决策回调（异步） */
  ask?: (question: string, options: { allow: string; deny: string; allowAll?: string }) => Promise<'allow' | 'deny' | 'allowAll'>;
  /** 取消信号 */
  signal?: AbortSignal;
}

export interface ToolInvocation {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolDefinition<TInput = Record<string, unknown>> {
  schema: ToolSchema;
  source: ToolSource;
  /** 校验输入（可选） */
  validate?: (input: TInput) => string | null;
  /** 执行 */
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult>;
  /** 用户友好展示 */
  renderUse?: (input: TInput) => string;
  /** 渲染工具结果 */
  renderResult?: (result: ToolResult) => string | ContentPart[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}