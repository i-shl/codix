/**
 * Gemini 适配器
 */
import { BaseModelAdapter, makeFetch, parseSSE, truncateErrorBody } from './base.js';
import type { ChatRequest, ModelAdapter, ModelConfig, StreamEvent } from '../types/model.js';
import type { ContentPart, Message } from '../types/message.js';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';

export class GeminiAdapter extends BaseModelAdapter {
  readonly config: ModelConfig;

  constructor(config: ModelConfig) {
    super();
    if (!config.model) throw new Error('model is required');
    this.config = { ...config, baseURL: config.baseURL ?? DEFAULT_BASE };
  }

  prepareRequest(request: ChatRequest): unknown {
    const sysParts = request.system ? [{ text: request.system }] : undefined;
    const contents: any[] = [];
    for (const m of request.messages) {
      if (m.role === 'system') continue;
      contents.push(toGeminiContent(m));
    }
    const tools = request.tools?.length
      ? [{ functionDeclarations: request.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })) }]
      : undefined;
    return {
      contents,
      systemInstruction: sysParts ? { parts: sysParts } : undefined,
      tools,
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
        temperature: request.temperature,
        stopSequences: request.stop,
      },
      ...this.config.extra,
    };
  }

  protected async *doStream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const body = this.prepareRequest(request);
    const url = `${this.config.baseURL}/v1beta/models/${this.config.model}:streamGenerateContent?alt=sse`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...this.config.headers };
    if (this.config.apiKey) headers['x-goog-api-key'] = this.config.apiKey;
    const res = await makeFetch(request.signal)(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', error: new Error(`Gemini HTTP ${res.status}: ${truncateErrorBody(text)}`) };
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
    const toolCalls = new Map<string, { id: string; name: string; input: string }>();
    let usage = { input: 0, output: 0 };

    // Gemini SSE 与 OpenAI 类似：data: {...}
    const decoder = new TextDecoder('utf8');
    let buffer = '';
    const reader = res.body.getReader();
    const parseSSE = async function* () {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (data === '[DONE]') return;
              try {
                yield JSON.parse(data);
              } catch {}
            }
          }
        }
      }
    };

    for await (const json of parseSSE()) {
      const cand = json.candidates?.[0];
      if (!cand) continue;
      const parts = cand.content?.parts ?? [];
      for (const p of parts) {
        if (p.text !== undefined) {
          yield { type: 'text_delta', text: p.text };
        }
        if (p.functionCall) {
          const id = `gemini-${Math.random().toString(36).slice(2, 10)}`;
          const name = p.functionCall.name;
          const input = JSON.stringify(p.functionCall.args ?? {});
          toolCalls.set(id, { id, name, input });
          yield { type: 'tool_use_start', id, name };
          yield { type: 'tool_use_end', id, input: safeJson(input) };
        }
      }
      if (cand.finishReason) {
        finishReason = { type: 'finish', reason: mapFinishReason(cand.finishReason) };
        // SAFETY / RECITATION / OTHER = 业务失败，输出 error 事件让 runner 知道是硬错误
        if (finishReason.reason === 'error' && cand.finishReason !== 'STOP' && cand.finishReason !== 'MAX_TOKENS') {
          yield { type: 'error', error: new Error(`Gemini blocked: ${cand.finishReason}`) };
        }
      }
      if (json.usageMetadata) {
        usage.input = json.usageMetadata.promptTokenCount ?? usage.input;
        usage.output = json.usageMetadata.candidatesTokenCount ?? usage.output;
      }
    }
    yield { type: 'usage', input: usage.input, output: usage.output };
    yield finishReason;
  }
}

function mapFinishReason(r: string): 'stop' | 'tool_use' | 'length' | 'error' {
  if (r === 'STOP') return 'stop';
  if (r === 'MAX_TOKENS') return 'length';
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

function toGeminiContent(m: Message): any {
  const role = m.role === 'assistant' ? 'model' : 'user';
  if (m.role === 'tool') {
    const parts = [
      {
        functionResponse: {
          name: m.toolResult?.toolCallId ?? 'tool',
          response: { content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) },
        },
      },
    ];
    return { role: 'user', parts };
  }
  const parts: any[] = [];
  if (typeof m.content === 'string') {
    if (m.content) parts.push({ text: m.content });
  } else {
    for (const p of m.content) parts.push(toGeminiPart(p));
  }
  for (const t of m.toolCalls ?? []) {
    parts.push({ functionCall: { name: t.name, args: t.input } });
  }
  return { role, parts };
}

function toGeminiPart(p: ContentPart): any {
  if (p.type === 'text') return { text: p.text };
  if (p.type === 'image') {
    if (p.source.type === 'base64') {
      return { inlineData: { mimeType: p.source.mediaType, data: p.source.data } };
    }
    return { fileData: { mimeType: p.source.mediaType, fileUri: p.source.data } };
  }
  if (p.type === 'file') {
    return { text: `[Attached file: ${p.fileName} (${p.mediaType}, ${p.data.length} chars base64)]` };
  }
  return { text: '' };
}

export function createGemini(config: ModelConfig): ModelAdapter {
  return new GeminiAdapter(config);
}