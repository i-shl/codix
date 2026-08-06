/**
 * 模型类型 - 统一多 provider 接口
 */
import type { ContentPart, Message, ToolUse } from './message.js';

/**
 * 协议类型。
 * - `openai-compatible`：/chat/completions（OpenAI 官方、DeepSeek、Ollama、vLLM… 绝大多数情况）
 * - `openai-responses` ：/responses（OpenAI Responses API）
 * - `anthropic` / `gemini`
 * - `openai`：历史遗留别名，等价于 `openai-compatible`，仅为兼容旧配置保留
 */
export type ModelProvider =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic'
  | 'gemini'
  | 'openai';

/**
 * 供应商配置 —— 一个供应商可以挂多个模型。
 * 模型上的 apiKey / baseURL / headers 若留空，则继承所属供应商的值。
 */
export interface ProviderConfig {
  /** 展示名，例如 "DeepSeek" */
  label?: string;
  /** 协议类型 */
  type: ModelProvider;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

export interface ModelConfig {
  provider: ModelProvider;
  /** 所属供应商 id（指向 GlobalConfig.providers），可选，向后兼容 */
  providerId?: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 最大输出 token */
  maxOutputTokens?: number;
  /** 上下文窗口 */
  contextWindow?: number;
  /** 额外参数透传 */
  extra?: Record<string, unknown>;
}

export interface ChatRequest {
  system?: string;
  messages: Message[];
  tools?: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[];
  /** 流式 */
  stream?: boolean;
  /** 最大输出 token */
  maxOutputTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 停止词 */
  stop?: string[];
  /** 取消 */
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: 'start'; model: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialInput: string }
  | { type: 'tool_use_end'; id: string; input: Record<string, unknown> }
  | { type: 'usage'; input: number; output: number; cacheRead?: number; cacheWrite?: number }
  | { type: 'error'; error: Error }
  | { type: 'finish'; reason: 'stop' | 'tool_use' | 'length' | 'error' };

export interface ChatResponse {
  text: string;
  toolCalls: ToolUse[];
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  finishReason: 'stop' | 'tool_use' | 'length' | 'error';
  model: string;
}

export interface ModelAdapter {
  readonly config: ModelConfig;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;
  /** 把 messages + tools 转成 provider 协议 */
  prepareRequest(request: ChatRequest): unknown;
  /** 把 provider 响应转成统一消息或事件 */
  parseResponse?(raw: unknown): ChatResponse;
}