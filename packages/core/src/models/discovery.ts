/**
 * 供应商模型发现 & 连通性测试
 *
 * - listProviderModels：调用供应商的 "列出模型" 接口，拿到全部可用模型 id
 * - testModelConnectivity：发一个极小的请求，验证 key / baseURL / 模型名确实可用
 * - resolveModelConfig：把供应商上的 apiKey / baseURL / headers 合并进模型配置
 */
import type { ModelConfig, ProviderConfig, ModelProvider } from '../types/model.js';
import { createAdapter } from './registry.js';
import { truncateErrorBody } from './base.js';

/** 各协议的默认 baseURL */
export const DEFAULT_BASE_URLS: Record<ModelProvider, string> = {
  openai: 'https://api.openai.com/v1',
  'openai-compatible': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

/**
 * 把供应商配置合并进模型配置。模型级字段优先，留空则继承供应商。
 */
export function resolveModelConfig(
  model: ModelConfig,
  providers?: Record<string, ProviderConfig>
): ModelConfig {
  const p = model.providerId ? providers?.[model.providerId] : undefined;
  if (!p) return model;
  return {
    ...model,
    provider: model.provider ?? p.type,
    apiKey: model.apiKey ?? p.apiKey,
    baseURL: model.baseURL ?? p.baseURL,
    headers: p.headers || model.headers ? { ...p.headers, ...model.headers } : undefined,
  };
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, done: () => clearTimeout(t) };
}

export interface DiscoveredModel {
  id: string;
  /** 供应商返回的额外描述（owner / 创建时间等） */
  detail?: string;
}

/**
 * 拉取供应商下全部可用模型。
 * 不同协议的端点：
 *  - openai / openai-compatible: GET {baseURL}/models          Authorization: Bearer
 *  - anthropic:                  GET {baseURL}/v1/models       x-api-key + anthropic-version
 *  - gemini:                     GET {baseURL}/models?key=xxx
 */
export async function listProviderModels(
  provider: Pick<ProviderConfig, 'type' | 'apiKey' | 'baseURL' | 'headers'>,
  opts: { timeoutMs?: number } = {}
): Promise<DiscoveredModel[]> {
  const type = provider.type;
  const base = trimSlash(provider.baseURL || DEFAULT_BASE_URLS[type]);
  const { signal, done } = withTimeout(opts.timeoutMs ?? 20_000);

  try {
    let url: string;
    const headers: Record<string, string> = { Accept: 'application/json', ...provider.headers };

    if (type === 'anthropic') {
      url = `${base}/v1/models?limit=1000`;
      if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (type === 'gemini') {
      url = `${base}/models?pageSize=1000${provider.apiKey ? `&key=${encodeURIComponent(provider.apiKey)}` : ''}`;
    } else {
      url = `${base}/models`;
      if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    const res = await fetch(url, { method: 'GET', headers, signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${truncateErrorBody(body, 300)}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return normalizeModelList(type, json);
  } finally {
    done();
  }
}

function normalizeModelList(type: ModelProvider, json: Record<string, unknown>): DiscoveredModel[] {
  const out: DiscoveredModel[] = [];
  if (type === 'gemini') {
    const arr = (json.models as Array<Record<string, unknown>>) ?? [];
    for (const m of arr) {
      const name = String(m.name ?? '');
      if (!name) continue;
      out.push({
        id: name.startsWith('models/') ? name.slice('models/'.length) : name,
        detail: typeof m.displayName === 'string' ? m.displayName : undefined,
      });
    }
  } else {
    // openai / anthropic 都是 { data: [ { id, ... } ] }
    const arr = (json.data as Array<Record<string, unknown>>) ?? [];
    for (const m of arr) {
      const id = String(m.id ?? '');
      if (!id) continue;
      const owner = typeof m.owned_by === 'string' ? m.owned_by : undefined;
      const display = typeof m.display_name === 'string' ? m.display_name : undefined;
      out.push({ id, detail: display ?? owner });
    }
  }
  // 去重 + 按 id 排序
  const seen = new Set<string>();
  return out
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface ModelTestResult {
  ok: boolean;
  /** 往返耗时（毫秒） */
  latencyMs: number;
  /** 失败原因 */
  error?: string;
  /** 成功时模型回复的前若干字符，用于人工确认确实通了 */
  sample?: string;
}

/**
 * 发一个极小请求测试模型可用性（1 条消息 / 最多 16 token 输出）。
 */
export async function testModelConnectivity(
  model: ModelConfig,
  opts: { timeoutMs?: number; providers?: Record<string, ProviderConfig> } = {}
): Promise<ModelTestResult> {
  const cfg = resolveModelConfig(model, opts.providers);
  const started = Date.now();
  const { signal, done } = withTimeout(opts.timeoutMs ?? 30_000);
  const adapter = createAdapter(cfg);

  const probe = async (maxOutputTokens?: number): Promise<string> => {
    const res = await adapter.chat({
      messages: [{ id: 'probe', role: 'user', content: 'ping' }],
      stream: true,
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      signal,
    });
    return res.text;
  };

  try {
    let text: string;
    try {
      // 先带一个很小的输出上限，省 token
      text = await probe(16);
    } catch (first) {
      // 不少推理模型/网关会拒绝 max_tokens（要求 max_completion_tokens），
      // 而真正聊天时并不会带这个参数 —— 这会导致「能聊天但测试失败」。
      // 因此失败后不带上限重试一次，只有两次都失败才算不通。
      if (signal.aborted) throw first;
      text = await probe(undefined);
    }
    return {
      ok: true,
      latencyMs: Date.now() - started,
      sample: text.slice(0, 120),
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: signal.aborted ? '请求超时' : truncateErrorBody(msg, 300),
    };
  } finally {
    done();
  }
}
