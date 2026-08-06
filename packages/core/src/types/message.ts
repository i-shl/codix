/**
 * 消息类型 - 兼容多模态、工具调用、流式
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  /** data URL 或 http(s) URL */
  source: { type: 'base64' | 'url'; mediaType: string; data: string };
}

export interface FilePart {
  type: 'file';
  fileName: string;
  mediaType: string;
  data: string; // base64
}

export type ContentPart = TextPart | ImagePart | FilePart;

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string | ContentPart[];
  isError?: boolean;
}

export interface Message {
  id: string;
  role: Role;
  /** 内容：纯文本或富内容（多模态） */
  content: string | ContentPart[];
  /** assistant 的思考过程（reasoning），应始终保留并展示 */
  thinking?: string;
  /** assistant 的工具调用 */
  toolCalls?: ToolUse[];
  /** tool 角色的工具结果 */
  toolResult?: ToolResult;
  /** 元数据 */
  meta?: {
    /** 完整模型名 */
    model?: string;
    /** token 消耗 */
    usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
    /** 时间戳 */
    timestamp: number;
    /** 关联会话 id */
    sessionId?: string;
    /** 是否为压缩摘要 */
    synthetic?: boolean;
  };
}

/** 用户输入（来自 CLI 或 UI） */
export interface UserInput {
  text?: string;
  images?: { mediaType: string; data: string }[];
  files?: { fileName: string; mediaType: string; data: string }[];
}