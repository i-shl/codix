/**
 * 会话管理 - 提供新建/恢复/继续/删除/列表
 */
import { randomUUID } from 'node:crypto';
import { SessionStore } from './store.js';
import type { Session } from '../types/session.js';
import type { Message } from '../types/message.js';

export class SessionManager {
  private store: SessionStore;
  constructor(opts?: { baseDir?: string }) {
    this.store = new SessionStore(opts?.baseDir);
  }

  list() {
    return this.store.list();
  }
  load(id: string) {
    return this.store.load(id);
  }
  delete(id: string) {
    return this.store.delete(id);
  }

  async create(opts: { cwd: string; title?: string; model?: string }): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      title: opts.title ?? 'New Session',
      cwd: opts.cwd,
      model: opts.model,
      createdAt: now,
      updatedAt: now,
      messages: [],
      meta: { projectRoot: opts.cwd },
    };
    await this.store.save(session);
    return session;
  }

  async appendMessage(id: string, msg: Message): Promise<Session> {
    const s = await this.store.load(id);
    if (!s) throw new Error(`Session not found: ${id}`);
    s.messages.push(msg);
    if (s.title === 'New Session' && msg.role === 'user' && typeof msg.content === 'string') {
      s.title = msg.content.slice(0, 40);
    }
    await this.store.save(s);
    return s;
  }

  store$() {
    return this.store;
  }
}