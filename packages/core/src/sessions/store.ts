/**
 * 会话存储
 *
 * 存储路径：
 *   ~/.codix/sessions/<sessionId>.json
 *
 * 每个会话存为单个 JSON 文件，方便复制/备份/查看。
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { CODIX_HOME, ensureDir, fileExists, writeFileAtomic } from '../utils/fs.js';
import type { Session, SessionSummary } from '../types/session.js';

export class SessionStore {
  constructor(private baseDir: string = path.join(CODIX_HOME, 'sessions')) {}

  async list(): Promise<SessionSummary[]> {
    await ensureDir(this.baseDir);
    const files = (await fs.readdir(this.baseDir)).filter((f) => f.endsWith('.json'));
    const out: SessionSummary[] = [];
    for (const f of files) {
      try {
        const s = await this.load(f.replace(/\.json$/, ''));
        if (s) out.push(toSummary(s));
      } catch {}
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  async load(id: string): Promise<Session | null> {
    const p = path.join(this.baseDir, `${id}.json`);
    if (!(await fileExists(p))) return null;
    const text = await fs.readFile(p, 'utf8');
    try {
      return JSON.parse(text) as Session;
    } catch {
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    await ensureDir(this.baseDir);
    session.updatedAt = Date.now();
    const p = path.join(this.baseDir, `${session.id}.json`);
    await writeFileAtomic(p, JSON.stringify(session, null, 2));
  }

  async delete(id: string): Promise<void> {
    const p = path.join(this.baseDir, `${id}.json`);
    await fs.rm(p, { force: true });
  }
}

function toSummary(s: Session): SessionSummary {
  const preview = s.messages
    .slice()
    .reverse()
    .find((m) => m.role === 'user' && typeof m.content === 'string');
  return {
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    model: s.model,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
    preview: typeof preview?.content === 'string' ? preview.content.slice(0, 80) : undefined,
  };
}