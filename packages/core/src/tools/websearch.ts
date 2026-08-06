/**
 * WebSearch - 联网搜索
 *
 * 支持：brave / tavily / duckduckgo（无需 key）
 */
import { BaseTool, jsonSchema } from './base.js';

export class WebSearchTool extends BaseTool<{ query: string; maxResults?: number }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'WebSearch',
    '联网搜索并返回前 N 条结果。',
    {
      query: { type: 'string' },
      maxResults: { type: 'integer', default: 8 },
    },
    ['query']
  );

  constructor(private config?: { provider?: 'brave' | 'tavily' | 'duckduckgo'; apiKey?: string }) {
    super();
  }

  renderUse(input: { query: string }): string {
    return `WebSearch "${input.query}"`;
  }

  async execute(input: { query: string; maxResults?: number }): Promise<import('../types/message.js').ToolResult> {
    const provider = this.config?.provider ?? 'duckduckgo';
    try {
      let results: { title: string; url: string; snippet: string }[] = [];
      if (provider === 'brave') results = await braveSearch(input.query, this.config?.apiKey);
      else if (provider === 'tavily') results = await tavilySearch(input.query, this.config?.apiKey);
      else results = await ddgSearch(input.query);
      const max = input.maxResults ?? 8;
      const sliced = results.slice(0, max);
      if (!sliced.length) return { toolCallId: '', content: '(no results)' };
      const text = sliced.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
      return { toolCallId: '', content: text };
    } catch (e) {
      return { toolCallId: '', content: `Error: ${(e as Error).message}`, isError: true };
    }
  }
}

async function braveSearch(query: string, apiKey?: string): Promise<{ title: string; url: string; snippet: string }[]> {
  if (!apiKey) throw new Error('Brave API key required');
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
    headers: { 'X-Subscription-Token': apiKey },
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const json = (await res.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (json.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function tavilySearch(query: string, apiKey?: string): Promise<{ title: string; url: string; snippet: string }[]> {
  if (!apiKey) throw new Error('Tavily API key required');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 10 }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const json = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function ddgSearch(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  // DuckDuckGo HTML 接口（无需 key）
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
  const html = await res.text();
  const results: { title: string; url: string; snippet: string }[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    const snippet = m[3].replace(/<[^>]+>/g, '').trim();
    if (url && title) results.push({ title, url, snippet });
  }
  return results;
}