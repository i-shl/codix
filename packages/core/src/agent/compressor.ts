/**
 * 上下文压缩 - 当消息历史过长时，调用模型生成摘要压缩
 */
import type { ModelAdapter } from '../types/model.js';
import type { Message } from '../types/message.js';
import { uid } from '../utils/common.js';

export interface CompressorOptions {
  /** 触发压缩的字符数阈值 */
  thresholdChars?: number;
  /** 保留最近多少条消息不压缩 */
  preserveLast?: number;
  /** 摘要最大 token */
  maxOutputTokens?: number;
}

export class ContextCompressor {
  constructor(private adapter: ModelAdapter, private opts: CompressorOptions = {}) {}

  shouldCompress(messages: Message[]): boolean {
    const threshold = this.opts.thresholdChars ?? 100_000;
    const total = messages.reduce((sum, m) => {
      // 跳过 synthetic 摘要，避免越压越肥
      if (m.meta?.synthetic) return sum;
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return sum + c.length;
    }, 0);
    return total > threshold;
  }

  async compress(messages: Message[]): Promise<Message[]> {
    const preserveLast = this.opts.preserveLast ?? 6;
    // 只压缩非 synthetic 消息（之前的摘要不再参与）
    const realMessages = messages.filter((m) => !m.meta?.synthetic);
    if (realMessages.length <= preserveLast + 1) return messages;
    const toSummarize = realMessages.slice(0, realMessages.length - preserveLast);
    const toKeep = realMessages.slice(realMessages.length - preserveLast);

    const sysMsg = toSummarize.find((m) => m.role === 'system');
    const others = toSummarize.filter((m) => m !== sysMsg);

    const summaryPrompt: Message[] = [
      {
        id: uid('sys_'),
        role: 'system',
        content:
          'You are a conversation summarizer. Produce a compact summary capturing:\n' +
          '1. The overall goal\n2. Steps already taken and outcomes\n3. Files and functions involved\n4. Remaining tasks\n5. Any user preferences or constraints\nBe concise; use bullet points.',
      },
      ...others,
      { id: uid('u_'), role: 'user', content: '请总结以上对话。' },
    ];
    const resp = await this.adapter.chat({
      messages: summaryPrompt,
      maxOutputTokens: this.opts.maxOutputTokens ?? 1500,
      stream: false,
    });
    const summary: Message = {
      id: uid('s_'),
      role: 'system',
      content: `<conversation_summary>\n${resp.text}\n</conversation_summary>`,
      meta: { timestamp: Date.now(), synthetic: true, model: this.adapter.config.model },
    };

    const out: Message[] = [];
    if (sysMsg) out.push(sysMsg);
    out.push(summary);
    out.push(...toKeep);
    return out;
  }
}