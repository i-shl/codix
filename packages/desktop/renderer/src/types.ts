/**
 * 全局类型声明 - 暴露给 window.codix 的 API
 */

declare global {
  interface Window {
    codix: import('./api').codixAPI;
  }
}

export interface Session {
  id: string;
  title: string;
  cwd: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview?: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; mediaType: string; data: string } }
  | { type: 'file'; fileName: string; mediaType: string; data: string };

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  /** assistant 的思考过程（reasoning），应始终保留并展示 */
  thinking?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  toolResult?: { toolCallId: string; content: string; isError?: boolean };
  meta?: {
    model?: string;
    usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
    timestamp?: number;
    sessionId?: string;
    synthetic?: boolean;
  };
}

export interface PermissionAsk {
  tool: string;
  input: Record<string, unknown>;
  description: string;
  options: { allow: string; deny: string; allowAll?: string };
}

// 顶栏不再显示 tab。skills/mcp/rules 合并进 settings。
export type Tab = 'chat' | 'settings';

export {};