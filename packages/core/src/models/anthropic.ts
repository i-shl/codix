/**
 * Anthropic 适配器
 */
import { BaseModelAdapter, authHeaders, makeFetch, parseSSE, truncateErrorBody } from './base.js';
import type { ChatRequest, ModelAdapter, ModelConfig, StreamEvent } from '../types/model.js';
import type { ContentPart, Message, ToolUse } from '../types/message.js';

const DEFAULT_BASE = 'https://api.anthropic.com';

export class AnthropicAdapter extends BaseModelAdapter {
  readonly config: ModelConfig;

  constructor(config: ModelConfig) {
    super();
    if (!config.model) throw new Error('model is required');
    this.config = { ...config, baseURL: config.baseURL ?? DEFAULT_BASE };
  }

  prepareRequest(request: ChatRequest): unknown {
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map(toAnthropicMessage);
    const tools = request.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
    return {
      model: this.config.model,
      system: request.system,
      messages,
      tools: tools?.length ? tools : undefined,
      max_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens ?? 4096,
      temperature: request.temperature,
      stream: request.stream ?? true,
      ...this.config.extra,
    };
  }

  protected async *doStream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const body = this.prepareRequest(request);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...this.config.headers,
    };
    // 'anthropic-dangerous-direct-browser-access' 仅在浏览器环境需要；Node 后端/CLI 不加
    if (typeof window !== 'undefined') {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;
    const url = `${this.config.baseURL}/v1/messages`;
    const res = await makeFetch(request.signal)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', error: new Error(`Anthropic HTTP ${res.status}: ${truncateErrorBody(text)}`) };
      yield { type: 'finish', reason: 'error' };
      return;
    }
    if (!res.body) {
      yield { type: 'error', error: new Error('No response body') };
      yield { type: 'finish', reason: 'error' };
      return;
    }
    yield { type: 'start', model: this.config.model };
    let textBuf = '';
    let finishReason: StreamEvent = { type: 'finish', reason: 'stop' };
    const toolCalls = new Map<string, { id: string; name: string; input: string }>();
    let currentToolId: string | undefined;
    let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    for await (const block of parseSSE(res.body)) {
      const ev = block.event ?? 'message';
      let json: any;
      try {
        json = JSON.parse(block.data);
      } catch {
        continue;
      }
      switch (ev) {
        case 'message_start': {
          const u = json.message?.usage;
          if (u) {
            usage.input = u.input_tokens ?? 0;
            usage.output = u.output_tokens ?? 0;
            usage.cacheRead = u.cache_read_input_tokens ?? 0;
            usage.cacheWrite = u.cache_creation_input_tokens ?? 0;
          }
          break;
        }
        case 'content_block_start': {
          const block = json.content_block;
          if (block?.type === 'tool_use') {
            currentToolId = block.id;
            toolCalls.set(block.id, { id: block.id, name: block.name, input: '' });
            yield { type: 'tool_use_start', id: block.id, name: block.name };
          }
          break;
        }
        case 'content_block_delta': {
          const d = json.delta;
          if (d?.type === 'text_delta') {
            textBuf += d.text;
            yield { type: 'text_delta', text: d.text };
          } else if (d?.type === 'thinking_delta') {
            yield { type: 'thinking_delta', text: d.thinking };
          } else if (d?.type === 'input_json_delta' && currentToolId) {
            const t = toolCalls.get(currentToolId);
            if (t) {
              t.input += d.partial_json;
              yield { type: 'tool_use_delta', id: currentToolId, partialInput: d.partial_json };
            }
          }
          break;
        }
        case 'content_block_stop': {
          if (currentToolId) {
            const t = toolCalls.get(currentToolId);
            if (t) yield { type: 'tool_use_end', id: currentToolId, input: safeJson(t.input) };
            currentToolId = undefined;
          }
          break;
        }
        case 'message_delta': {
          const u = json.usage;
          if (u) {
            usage.output = u.output_tokens ?? usage.output;
          }
          if (json.delta?.stop_reason) {
            finishReason = { type: 'finish', reason: mapFinishReason(json.delta.stop_reason) };
          }
          break;
        }
        case 'message_stop': {
          yield { type: 'usage', input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite };
          yield finishReason;
          return;
        }
      }
    }
    yield { type: 'usage', input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite };
    yield finishReason;
  }
}

function mapFinishReason(r: string): 'stop' | 'tool_use' | 'length' | 'error' {
  if (r === 'end_turn' || r === 'stop_sequence') return 'stop';
  if (r === 'tool_use') return 'tool_use';
  if (r === 'max_tokens') return 'length';
  return 'error';
}

function safeJson(s: string): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

function toAnthropicMessage(m: Message): unknown {
  if (m.role === 'user') {
    if (typeof m.content === 'string') return { role: 'user', content: m.content };
    return { role: 'user', content: m.content.map(toAnthropicPart) };
  }
  if (m.role === 'assistant') {
    const blocks: any[] = [];
    if (typeof m.content === 'string') {
      if (m.content) blocks.push({ type: 'text', text: m.content });
    } else {
      for (const p of m.content) blocks.push(toAnthropicPart(p));
    }
    for (const t of m.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input });
    }
    return { role: 'assistant', content: blocks };
  }
  if (m.role === 'tool') {
    if (!m.toolResult) return { role: 'user', content: '' };
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: m.toolResult.toolCallId,
          content: typeof m.toolResult.content === 'string' ? m.toolResult.content : m.toolResult.content.map(toAnthropicPart),
          is_error: m.toolResult.isError,
        },
      ],
    };
  }
  return { role: 'user', content: '' };
}

function toAnthropicPart(p: ContentPart): any {
  if (p.type === 'text') return { type: 'text', text: p.text };
  if (p.type === 'image') {
    if (p.source.type === 'base64') {
      return { type: 'image', source: { type: 'base64', media_type: p.source.mediaType, data: p.source.data } };
    }
    return { type: 'image', source: { type: 'url', url: p.source.data } };
  }
  if (p.type === 'file') {
    return { type: 'text', text: `[Attached file: ${p.fileName} (${p.mediaType}, ${p.data.length} chars base64)]` };
  }
  return { type: 'text', text: '' };
}

export function createAnthropic(config: ModelConfig): ModelAdapter {
  return new AnthropicAdapter(config);
}