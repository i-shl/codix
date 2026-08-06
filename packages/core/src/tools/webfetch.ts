/**
 * WebFetch - 抓取网页内容
 */
import { BaseTool, jsonSchema } from './base.js';

const MAX_BYTES = 500_000;

export class WebFetchTool extends BaseTool<{ url: string; prompt?: string }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'WebFetch',
    '抓取 URL 内容并返回纯文本（HTML 会被简化）。可选 prompt 提示模型聚焦的信息。',
    {
      url: { type: 'string', description: 'HTTP(S) URL' },
      prompt: { type: 'string', description: '提取重点的提示' },
    },
    ['url']
  );

  renderUse(input: { url: string }): string {
    return `WebFetch ${input.url}`;
  }

  async execute(input: { url: string; prompt?: string }): Promise<import('../types/message.js').ToolResult> {
    let u: URL;
    try {
      u = new URL(input.url);
    } catch {
      return { toolCallId: '', content: 'Error: URL 格式不合法', isError: true };
    }
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { toolCallId: '', content: `Error: 仅支持 http(s) 协议`, isError: true };
    }
    // SSRF 防御：解析主机名后拒绝私有/loopback/link-local
    const host = u.hostname.toLowerCase();
    if (isBlockedHost(host)) {
      return { toolCallId: '', content: `Error: 拒绝访问私有地址 ${host}`, isError: true };
    }
    try {
      const res = await fetch(input.url, { headers: { 'User-Agent': 'voked/0.1' } });
      if (!res.ok) return { toolCallId: '', content: `Error: HTTP ${res.status}`, isError: true };
      const ct = res.headers.get('content-type') ?? '';
      let body = await res.text();
      if (body.length > MAX_BYTES) body = body.slice(0, MAX_BYTES) + '\n[truncated]';
      if (ct.includes('text/html')) {
        body = stripHtml(body);
      }
      return { toolCallId: '', content: body };
    } catch (e) {
      return { toolCallId: '', content: `Error: ${(e as Error).message}`, isError: true };
    }
  }
}

function isBlockedHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  // 169.254.x.x（link-local / cloud metadata）
  if (/^169\.254\./.test(host)) return true;
  // 私有 IPv4
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // IPv6 私有
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('fe80:')) return true;
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}