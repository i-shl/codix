/**
 * 模型适配层 - 基类 & 工具
 */
import { ModelError } from '../errors.js';
import type { ChatRequest, ChatResponse, ModelAdapter, StreamEvent } from '../types/model.js';

export abstract class BaseModelAdapter implements ModelAdapter {
  abstract readonly config: import('../types/model.js').ModelConfig;

  prepareRequest(request: ChatRequest): unknown {
    return request;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const events: StreamEvent[] = [];
    let final: ChatResponse | undefined;
    for await (const ev of this.stream(request)) {
      events.push(ev);
      if (ev.type === 'finish' && final === undefined) {
        // 等所有 delta 处理完再返回
      }
    }
    final = await this.collect(events, request);
    return final;
  }

  stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    return this.doStream(request);
  }

  protected abstract doStream(request: ChatRequest): AsyncIterable<StreamEvent>;

  /** 收集 stream 为 ChatResponse（默认实现） */
  protected async collect(events: StreamEvent[], request: ChatRequest): Promise<ChatResponse> {
    let text = '';
    const toolCallsMap = new Map<string, { id: string; name: string; input: string }>();
    let usage = { input: 0, output: 0 };
    let finishReason: ChatResponse['finishReason'] = 'stop';
    let model = this.config.model;
    for (const ev of events) {
      switch (ev.type) {
        case 'start':
          model = ev.model;
          break;
        case 'text_delta':
          text += ev.text;
          break;
        case 'thinking_delta':
          // 不计入 text；可独立展示
          break;
        case 'tool_use_start':
          toolCallsMap.set(ev.id, { id: ev.id, name: ev.name, input: '' });
          break;
        case 'tool_use_delta': {
          // 可能没有 start 事件（流截断）；懒创建
          const existing = toolCallsMap.get(ev.id) ?? { id: ev.id, name: '', input: '' };
          existing.input += ev.partialInput;
          toolCallsMap.set(ev.id, existing);
          break;
        }
        case 'tool_use_end': {
          const t = toolCallsMap.get(ev.id);
          if (t) {
            t.input = JSON.stringify(ev.input);
          }
          break;
        }
case 'usage':
        usage = { input: ev.input, output: ev.output, ...(ev.cacheRead !== undefined ? { cacheRead: ev.cacheRead } : {}), ...(ev.cacheWrite !== undefined ? { cacheWrite: ev.cacheWrite } : {}) };
        break;
        case 'finish':
          finishReason = ev.reason;
          break;
        case 'error':
          throw new ModelError(ev.error.message, ev.error);
      }
    }
    const toolCalls = Array.from(toolCallsMap.values()).map((t) => ({
      id: t.id,
      name: t.name,
      input: safeJson(t.input) as Record<string, unknown>,
    }));
    return { text, toolCalls, usage, finishReason, model };
  }
}

function safeJson(s: string): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

/** SSE 流解析 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<{ event?: string; data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      yield parseBlock(block);
    }
  }
  if (buffer.trim()) yield parseBlock(buffer);
}

function parseBlock(block: string): { event?: string; data: string } {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join('\n') };
}

/** 构造 fetch，带取消 */
export function makeFetch(signal?: AbortSignal): typeof fetch {
  // Node 18+ 自带 fetch
  const f = globalThis.fetch;
  if (!signal) return f;
  return (input: unknown, init?: RequestInit) => {
    return f(input as never, { ...init, signal });
  };
}

export function authHeaders(apiKey?: string, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
  return h;
}

/** 截断上游错误体（防止日志泄露完整响应，可能回显请求） */
export function truncateErrorBody(s: string, max = 1024): string {
  return s.length <= max ? s : s.slice(0, max) + `... [truncated ${s.length - max} chars]`;
}