/**
 * 会话类型
 */
import type { Message } from './message.js';

export interface Session {
  id: string;
  title: string;
  cwd: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** 元数据 */
  meta?: {
    /** 总 token */
    totalUsage?: { input: number; output: number };
    /** 项目根 */
    projectRoot?: string;
  };
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview?: string;
}