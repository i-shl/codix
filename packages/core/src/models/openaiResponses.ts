/**
 * OpenAI Responses API 适配器（POST {baseURL}/responses）
 *
 * 与 /chat/completions 的差异：
 *  - 请求体用 `input` 数组（item 形态），不是 `messages`
 *  - 工具是扁平的 { type: 'function', name, parameters }，不是嵌套 function 对象
 *  - 工具结果作为 `function_call_output` item 回传，用 call_id 关联
 *  - SSE 是带 `event:` 名的语义事件，而不是 delta 拼接
 */
import { BaseModelAdapter, makeFetch, parseSSE, truncateErrorBody } from './base.js';
import type { ChatRequest, ModelAdapter, ModelConfig, StreamEvent } from '../types/model.js';
import type { ContentPart, Message } from '../types/message.js';

export class OpenAIResponsesAdapter extends BaseModelAdapter {
  readonly config: ModelConfig;

  constructor(config: ModelConfig) {
    super();
    if (!config.model) throw new Error('model is required');
    this.config = {
      ...config,
      baseURL: config.baseURL ?? 'https://api.openai.com/v1',
    };
  }

  prepareRequest(request: ChatRequest): unknown {
    const input: unknown[] = [];
    for (const m of request.messages) {
      for (const item of toResponsesItems(m)) input.push(item);
    }
    const tools = request.tools?.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
    return {
      model: this.config.model,
      input,
      instructions: request.system,
      tools: tools?.length ? tools : undefined,
      stream: request.stream ?? true,
      temperature: request.temperature,
      max_output_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
      ...this.config.extra,
    };
  }

  protected async *doStream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const body = this.prepareRequest(request);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    const url = `${this.config.baseURL}/responses`;
    const res = await makeFetch(request.signal)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', error: new Error(`OpenAI Responses HTTP ${res.status}: ${truncateErrorBody(text)}`) };
      yield { type: 'finish', reason: 'error' };
      return;
    }
    if (!res.body) {
      yield { type: 'error', error: new Error('No response body') };
      yield { type: 'finish', reason: 'error' };
      return;
    }

    yield { type: 'start', model: this.config.model };

    /** output_index -> 工具调用累积 */
    const calls = new Map<number, { id: string; name: string; args: string; started: boolean }>();
    let finish: StreamEvent = { type: 'finish', reason: 'stop' };
    let sawError = false;

    for await (const block of parseSSE(res.body)) {
      if (!block.data || block.data === '[DONE]') continue;
      let ev: any;
      try {
        ev = JSON.parse(block.data);
      } catch {
        continue;
      }
      const type: string = ev.type ?? block.event ?? '';

      if (type === 'response.output_text.delta') {
        if (ev.delta) yield { type: 'text_delta', text: String(ev.delta) };
        continue;
      }
      if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        if (ev.delta) yield { type: 'thinking_delta', text: String(ev.delta) };
        continue;
      }
      if (type === 'response.output_item.added') {
        const item = ev.item ?? {};
        if (item.type === 'function_call') {
          const idx: number = typeof ev.output_index === 'number' ? ev.output_index : calls.size;
          calls.set(idx, {
            id: String(item.call_id ?? item.id ?? `call_${idx}`),
            name: String(item.name ?? ''),
            args: '',
            started: false,
          });
        }
        continue;
      }
      if (type === 'response.function_call_arguments.delta') {
        const idx: number = typeof ev.output_index === 'number' ? ev.output_index : 0;
        const cur = calls.get(idx);
        if (!cur) continue;
        if (!cur.started) {
          cur.started = true;
          yield { type: 'tool_use_start', id: cur.id, name: cur.name };
        }
        const frag = String(ev.delta ?? '');
        if (frag) {
          cur.args += frag;
          yield { type: 'tool_use_delta', id: cur.id, partialInput: frag };
        }
        continue;
      }
      if (type === 'response.function_call_arguments.done') {
        const idx: number = typeof ev.output_index === 'number' ? ev.output_index : 0;
        const cur = calls.get(idx);
        if (cur && typeof ev.arguments === 'string' && ev.arguments.length > cur.args.length) {
          cur.args = ev.arguments;
        }
        continue;
      }
      if (type === 'response.completed' || type === 'response.incomplete') {
        const usage = ev.response?.usage;
        if (usage) {
          yield {
            type: 'usage',
            input: Number(usage.input_tokens ?? 0),
            output: Number(usage.output_tokens ?? 0),
            ...(usage.input_tokens_details?.cached_tokens !== undefined
              ? { cacheRead: Number(usage.input_tokens_details.cached_tokens) }
              : {}),
          };
        }
        const reason = ev.response?.incomplete_details?.reason;
        if (reason === 'max_output_tokens') finish = { type: 'finish', reason: 'length' };
        continue;
      }
      if (type === 'response.failed' || type === 'error') {
        const msg =
          ev.response?.error?.message ?? ev.message ?? ev.error?.message ?? 'Responses API error';
        sawError = true;
        yield { type: 'error', error: new Error(truncateErrorBody(String(msg), 300)) };
        finish = { type: 'finish', reason: 'error' };
        continue;
      }
    }

    let emittedTool = false;
    for (const cur of calls.values()) {
      if (!cur.started) {
        cur.started = true;
        yield { type: 'tool_use_start', id: cur.id, name: cur.name };
      }
      emittedTool = true;
      yield { type: 'tool_use_end', id: cur.id, input: safeJson(cur.args) };
    }
    if (emittedTool && !sawError && finish.type === 'finish' && finish.reason === 'stop') {
      finish = { type: 'finish', reason: 'tool_use' };
    }
    yield finish;
  }
}

export function createOpenAIResponses(config: ModelConfig): ModelAdapter {
  return new OpenAIResponsesAdapter(config);
}

function safeJson(s: string): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return { _raw: s };
  }
}

/** 一条内部 Message → 0..N 个 Responses input item */
function toResponsesItems(m: Message): unknown[] {
  if (m.role === 'tool') {
    return [
      {
        type: 'function_call_output',
        call_id: m.toolResult?.toolCallId,
        output: typeof m.content === 'string' ? m.content : m.content.map(partToText).join(''),
      },
    ];
  }
  if (m.role === 'assistant') {
    const out: unknown[] = [];
    const text = typeof m.content === 'string' ? m.content : m.content.map(partToText).join('');
    if (text) {
      out.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
    }
    for (const t of m.toolCalls ?? []) {
      out.push({
        type: 'function_call',
        call_id: t.id,
        name: t.name,
        arguments: JSON.stringify(t.input ?? {}),
      });
    }
    return out;
  }
  if (m.role === 'system') {
    const text = typeof m.content === 'string' ? m.content : m.content.map(partToText).join('');
    return [{ role: 'system', content: [{ type: 'input_text', text }] }];
  }
  // user
  if (typeof m.content === 'string') {
    return [{ role: 'user', content: [{ type: 'input_text', text: m.content }] }];
  }
  return [{ role: 'user', content: m.content.map(toResponsesPart) }];
}

function toResponsesPart(p: ContentPart): unknown {
  if (p.type === 'image') {
    const url =
      p.source.type === 'base64' ? `data:${p.source.mediaType};base64,${p.source.data}` : p.source.data;
    return { type: 'input_image', image_url: url };
  }
  return { type: 'input_text', text: partToText(p) };
}

function partToText(p: ContentPart): string {
  if (p.type === 'text') return p.text;
  if (p.type === 'file') return `[Attached file: ${p.fileName} (${p.mediaType})]`;
  if (p.type === 'image') return '[image]';
  return '';
}
