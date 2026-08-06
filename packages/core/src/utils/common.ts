/**
 * 通用工具
 */
import { randomUUID } from 'node:crypto';

export function uid(prefix = ''): string {
  return prefix + randomUUID().slice(0, 8);
}

export function nowMs(): number {
  return Date.now();
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** 异步 map + 并发限制 */
export async function pMap<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 带超时的 Promise */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout?: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout?.() ?? new Error(`timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/** 简单互斥锁 */
export class Mutex {
  private chain: Promise<unknown> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

/** 对象深拷贝（JSON 安全） */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** 对象深合并 */
export function deepMerge<T>(target: T, source: Partial<T> | unknown): T {
  const t = (target ?? {}) as Record<string, unknown>;
  const s = (source ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = { ...t };
  for (const [key, value] of Object.entries(s)) {
    const existing = result[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && existing && typeof existing === 'object' && !Array.isArray(existing)) {
      result[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

/** 将 stream 转成 async iterable lines */
export async function* readLines(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  let buf = '';
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      yield line;
    }
  }
  if (buf.length) yield buf;
}