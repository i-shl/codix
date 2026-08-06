/**
 * OpenAI 兼容协议适配器
 *
 * 兼容：OpenAI 官方、Azure OpenAI、DeepSeek、Moonshot、智谱、Ollama（部分）等。
 */
import { BaseModelAdapter, authHeaders, makeFetch, parseSSE, truncateErrorBody } from './base.js';
import type { ChatRequest, ModelAdapter, ModelConfig, StreamEvent } from '../types/model.js';
import type { ContentPart, Message, ToolUse } from '../types/message.js';

export interface OpenAICompatibleAdapterOptions {
  baseURL?: string;
}

export class OpenAICompatibleAdapter extends BaseModelAdapter {
  readonly config: ModelConfig;

  constructor(config: ModelConfig, opts: OpenAICompatibleAdapterOptions = {}) {
    super();
    if (!config.model) throw new Error('model is required');
    this.config = {
      ...config,
      baseURL: config.baseURL ?? opts.baseURL ?? 'https://api.openai.com/v1',
    };
  }

  prepareRequest(request: ChatRequest): unknown {
    const messages = request.messages.map(toOpenAIMessage);
    const tools = request.tools?.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
    return {
      model: this.config.model,
      messages,
      tools: tools?.length ? tools : undefined,
      stream: request.stream ?? true,
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
      stop: request.stop,
      ...this.config.extra,
    };
  }

  protected async *doStream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const body = this.prepareRequest(request);
    const headers = authHeaders(this.config.apiKey, this.config.headers);
    const url = `${this.config.baseURL}/chat/completions`;
    const res = await makeFetch(request.signal)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', error: new Error(`OpenAI HTTP ${res.status}: ${truncateErrorBody(text)}`) };
      yield { type: 'finish', reason: 'error' };
      return;
    }
    if (!res.body) {
      yield { type: 'error', error: new Error('No response body') };
      yield { type: 'finish', reason: 'error' };
      return;
    }
    yield { type: 'start', model: this.config.model };
    let finishReason: StreamEvent = { type: 'finish', reason: 'stop' };
    /**
     * 流式 tool_calls 必须按 index 累积，不能「见到 id 就当作新调用」：
     * 不少 OpenAI 兼容服务会在每个增量块里重复同一个 id，
     * 那样会把一次调用拆成「有名字没参数」+ 若干「没名字有参数片段」，
     * 最终全部变成「未知工具」。
     */
    const calls = new Map<string, { id: string; name: string; args: string; started: boolean }>();
    const idToKey = new Map<string, string>();
    let lastKey: string | undefined;
    for await (const block of parseSSE(res.body)) {
      if (block.data === '[DONE]') break;
      let json: any;
      try {
        json = JSON.parse(block.data);
      } catch {
        continue;
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? choice.message;
      if (delta?.content) {
        yield { type: 'text_delta', text: delta.content };
      }
      if (delta?.reasoning_content) {
        yield { type: 'thinking_delta', text: delta.reasoning_content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          // index 是官方协议里唯一可靠的分组键；没有 index 时退回 id，再退回上一个调用
          const key =
            typeof tc.index === 'number'
              ? `i${tc.index}`
              : tc.id
                ? (idToKey.get(tc.id) ?? `d${tc.id}`)
                : (lastKey ?? 'i0');
          lastKey = key;
          let cur = calls.get(key);
          if (!cur) {
            cur = { id: tc.id ?? key, name: '', args: '', started: false };
            calls.set(key, cur);
          }
          if (tc.id) {
            if (!idToKey.has(tc.id)) idToKey.set(tc.id, key);
            // start 发出去之后 id 就定死了，否则后续事件会对不上号
            if (!cur.started) cur.id = tc.id;
          }
          if (tc.function?.name) cur.name += tc.function.name;
          const frag: string = tc.function?.arguments ?? '';
          if (frag) {
            // 参数一开始流，名字必然已经收全，这时才发 start（有的服务会把 name 拆成两块）
            if (!cur.started) {
              cur.started = true;
              yield { type: 'tool_use_start', id: cur.id, name: cur.name };
            }
            cur.args += frag;
            yield { type: 'tool_use_delta', id: cur.id, partialInput: frag };
          }
        }
      }
      if (choice.finish_reason) {
        finishReason = { type: 'finish', reason: mapFinishReason(choice.finish_reason) };
      }
    }
    for (const cur of calls.values()) {
      if (!cur.started) {
        // 无参工具（arguments 全程为空）走这里补一次 start
        cur.started = true;
        yield { type: 'tool_use_start', id: cur.id, name: cur.name };
      }
      yield { type: 'tool_use_end', id: cur.id, input: safeJson(cur.args) };
    }
    yield finishReason;
  }
}

export function createOpenAICompatible(config: ModelConfig): ModelAdapter {
  return new OpenAICompatibleAdapter(config);
}

function mapFinishReason(r: string): 'stop' | 'tool_use' | 'length' | 'error' {
  if (r === 'tool_calls') return 'tool_use';
  if (r === 'length') return 'length';
  if (r === 'stop') return 'stop';
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

function toOpenAIMessage(m: Message): unknown {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: m.toolResult?.toolCallId,
      content: typeof m.content === 'string' ? m.content : m.content.map(toOpenAIPart).join(''),
    };
  }
  if (m.role === 'assistant') {
    const tool_calls = m.toolCalls?.map((t) => ({
      id: t.id,
      type: 'function',
      function: { name: t.name, arguments: JSON.stringify(t.input) },
    }));
    return {
      role: 'assistant',
      content: typeof m.content === 'string' ? m.content : m.content.map(toOpenAIPart).join(''),
      tool_calls: tool_calls?.length ? tool_calls : undefined,
    };
  }
  if (m.role === 'system') {
    return { role: 'system', content: typeof m.content === 'string' ? m.content : m.content.map(toOpenAIPart).join('') };
  }
  // user
  if (typeof m.content === 'string') {
    return { role: 'user', content: m.content };
  }
  return { role: 'user', content: m.content.map(toOpenAIPart) };
}

function toOpenAIPart(p: ContentPart): unknown {
  if (p.type === 'text') return { type: 'text', text: p.text };
  if (p.type === 'image') {
    if (p.source.type === 'base64') {
      return { type: 'image_url', image_url: { url: `data:${p.source.mediaType};base64,${p.source.data}` } };
    }
    return { type: 'image_url', image_url: { url: p.source.data } };
  }
  if (p.type === 'file') {
    // OpenAI 没有原生 file part；转 text 描述
    return { type: 'text', text: `[Attached file: ${p.fileName} (${p.mediaType}, ${p.data.length} chars base64)]` };
  }
  return { type: 'text', text: '' };
}