/**
 * Agent 循环 - 核心 ReAct 风格循环
 *
 * 步骤：
 *   1. 构造 system + messages
 *   2. 流式调用模型
 *   3. 如果有 tool calls，逐个执行并把结果加入 messages
 *   4. 重复直到 finishReason !== tool_use，或达到 maxSteps
 */
import { uid } from '../utils/common.js';
import { getLogger } from '../logger.js';
import { ModelError, ToolError } from '../errors.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ModelAdapter } from '../types/model.js';
import type { Message, ToolUse } from '../types/message.js';
import type { ToolContext, ToolDefinition } from '../types/tool.js';
import type { ChatRequest, StreamEvent } from '../types/model.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { ContextCompressor } from './compressor.js';

const log = getLogger('agent');

export interface AgentCallbacks {
  /** 每收到一个 stream 事件 */
  onEvent?: (ev: StreamEvent) => void;
  /** assistant 开始思考（首字） */
  onAssistantStart?: () => void;
  /** 工具被调用 */
  onToolStart?: (call: ToolUse) => void;
  /** 工具完成 */
  onToolEnd?: (call: ToolUse, result: import('../types/message.js').ToolResult) => void;
  /** 询问用户权限 */
  onPermissionAsk?: (req: import('../types/permission.js').PermissionAskRequest) => Promise<'allow' | 'deny' | 'allowAll'>;
  /** 最终结束 */
  onFinish?: (messages: Message[]) => void;
}

export interface AgentOptions {
  model: ModelAdapter;
  tools: ToolDefinition[];
  permission?: PermissionEngine;
  compressor?: ContextCompressor;
  callbacks?: AgentCallbacks;
  maxSteps?: number;
  signal?: AbortSignal;
  cwd: string;
  sessionId: string;
  systemPrompt?: string;
}

export interface RunInput {
  messages: Message[];
  /** 新增的用户消息（追加到 messages） */
  userInput?: import('../types/message.js').UserInput;
}

export class AgentRunner {
  private opts: AgentOptions;

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  async run(input: RunInput): Promise<Message[]> {
    const maxSteps = this.opts.maxSteps ?? 30;
    const messages: Message[] = [...input.messages];
    if (input.userInput) {
      messages.push(await buildUserMessage(input.userInput, this.opts.sessionId));
    }
    let steps = 0;
    while (true) {
      if (this.opts.signal?.aborted) break;
      steps++;
      if (steps > maxSteps) {
        log.warn(`max steps reached: ${maxSteps}`);
        break;
      }

      // 压缩检查
      if (this.opts.compressor && this.opts.compressor.shouldCompress(messages)) {
        log.info('compressing context');
        const compressed = await this.opts.compressor.compress(messages);
        messages.length = 0;
        messages.push(...compressed);
      }

      const req: ChatRequest = {
        system: this.opts.systemPrompt,
        messages,
        tools: this.opts.tools.map((t) => ({
          name: t.schema.name,
          description: t.schema.description,
          inputSchema: t.schema.inputSchema,
        })),
        stream: true,
        signal: this.opts.signal,
      };
      const assistantMsg = await this.callModelStream(req);
      messages.push(assistantMsg);

      // 没有 tool calls -> 完成
      if (!assistantMsg.toolCalls?.length) {
        break;
      }
      // 执行工具
      for (const call of assistantMsg.toolCalls) {
        if (this.opts.signal?.aborted) break;
        this.opts.callbacks?.onToolStart?.(call);
        const result = await this.executeTool(call);
        this.opts.callbacks?.onToolEnd?.(call, result);
        const toolMsg: Message = {
          id: uid('tool_'),
          role: 'tool',
          content: result.content,
          toolResult: { ...result, toolCallId: call.id },
          meta: { timestamp: Date.now(), sessionId: this.opts.sessionId },
        };
        messages.push(toolMsg);
      }
    }
    this.opts.callbacks?.onFinish?.(messages);
    return messages;
  }

  private async callModelStream(req: ChatRequest): Promise<Message> {
    let text = '';
    let thinking = '';
    const toolCalls = new Map<string, { id: string; name: string; input: string }>();
    let currentId: string | undefined;
    let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let finishReason: 'stop' | 'tool_use' | 'length' | 'error' = 'stop';
    let started = false;

    try {
      for await (const ev of this.opts.model.stream(req)) {
        this.opts.callbacks?.onEvent?.(ev);
        switch (ev.type) {
          case 'start':
            if (!started) {
              started = true;
              this.opts.callbacks?.onAssistantStart?.();
            }
            break;
          case 'text_delta':
            if (!started) {
              started = true;
              this.opts.callbacks?.onAssistantStart?.();
            }
            text += ev.text;
            break;
          case 'thinking_delta':
            thinking += ev.text;
            break;
          case 'tool_use_start':
            if (!started) {
              started = true;
              this.opts.callbacks?.onAssistantStart?.();
            }
            currentId = ev.id;
            toolCalls.set(ev.id, { id: ev.id, name: ev.name, input: '' });
            break;
          case 'tool_use_delta': {
            // Anthropic may send deltas without a matching start on truncated streams; create lazily.
            const existing = toolCalls.get(ev.id) ?? { id: ev.id, name: '', input: '' };
            existing.input += ev.partialInput;
            toolCalls.set(ev.id, existing);
            break;
          }
          case 'tool_use_end': {
            const existing = toolCalls.get(ev.id);
            if (existing) existing.input = JSON.stringify(ev.input);
            currentId = undefined;
            break;
          }
          case 'usage':
            usage = { input: ev.input, output: ev.output, cacheRead: ev.cacheRead ?? 0, cacheWrite: ev.cacheWrite ?? 0 };
            break;
          case 'finish':
            finishReason = ev.reason;
            break;
          case 'error':
            throw new ModelError(ev.error.message, ev.error);
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        finishReason = 'stop';
      } else {
        throw e;
      }
    }

    const toolUses: ToolUse[] = Array.from(toolCalls.values()).map((t) => ({
      id: t.id,
      name: t.name,
      input: safeJson(t.input),
    }));

    return {
      id: uid('a_'),
      role: 'assistant',
      content: text,
      thinking: thinking.trim() ? thinking : undefined,
      toolCalls: toolUses.length ? toolUses : undefined,
      meta: {
        timestamp: Date.now(),
        model: this.opts.model.config.model,
        usage,
      },
    };
  }

  private async executeTool(call: ToolUse): Promise<import('../types/message.js').ToolResult> {
    const tool = this.opts.tools.find((t) => t.schema.name === call.name);
    if (!tool) {
      return { toolCallId: call.id, content: `Error: 未知工具 ${call.name}`, isError: true };
    }
    const ctx: ToolContext = {
      cwd: this.opts.cwd,
      sessionId: this.opts.sessionId,
      signal: this.opts.signal,
      ask: this.opts.callbacks?.onPermissionAsk
        ? async (description, options) =>
            this.opts.callbacks!.onPermissionAsk!({ tool: call.name, input: call.input, description, options })
        : undefined,
    };
    // 权限检查
    if (this.opts.permission) {
      try {
        await this.opts.permission.ensureAllowed(call.name, call.input, ctx, (input) => describeTool(call.name, input));
      } catch (e) {
        return { toolCallId: call.id, content: `Error: ${(e as Error).message}`, isError: true };
      }
    }
    try {
      return await tool.execute(call.input, ctx);
    } catch (e) {
      return { toolCallId: call.id, content: `Error: ${(e as Error).message}`, isError: true };
    }
  }
}

/**
 * 把用户输入转成一条 user 消息（含附件落盘）。
 * 单独导出，供 runAgent 在调用模型前先把 user 消息落盘，确保切走再切回时用户的输入不丢。
 */
export async function buildUserMessage(
  input: import('../types/message.js').UserInput,
  sessionId: string,
): Promise<Message> {
  const parts: import('../types/message.js').ContentPart[] = [];
  if (input.text) parts.push({ type: 'text', text: input.text });
  if (input.images) {
    for (const img of input.images) parts.push({ type: 'image', source: { type: 'base64', mediaType: img.mediaType, data: img.data } });
  }
  if (input.files) {
    for (const f of input.files) {
      parts.push({ type: 'file', fileName: f.fileName, mediaType: f.mediaType, data: f.data });
      const saved = await saveAttachment(sessionId, f);
      parts.push({ type: 'text', text: `[附件文件已保存到: ${saved}]` });
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') {
    return { id: uid('u_'), role: 'user', content: parts[0].text, meta: { timestamp: Date.now() } };
  }
  return { id: uid('u_'), role: 'user', content: parts, meta: { timestamp: Date.now() } };
}

function safeJson(s: string): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

function describeTool(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return `执行命令: ${String(input.command ?? '').slice(0, 300)}`;
  if (name === 'Write') return `写入文件: ${input.filePath}`;
  if (name === 'Edit') return `编辑文件: ${input.filePath}`;
  if (name === 'Read') return `读取文件: ${input.filePath}`;
  if (name === 'WebFetch') return `抓取: ${input.url}`;
  if (name === 'WebSearch') return `搜索: ${input.query}`;
  if (name.startsWith('mcp:')) return `调用 MCP 工具 ${name}: ${JSON.stringify(input).slice(0, 200)}`;
  return `调用 ${name}: ${JSON.stringify(input).slice(0, 200)}`;
}

/** 把用户上传的附件 base64 落盘到临时目录，返回绝对路径（供模型用 Read 读取） */
async function saveAttachment(sessionId: string, f: { fileName: string; data: string }): Promise<string> {
  const dir = path.join(os.tmpdir(), 'voked-attachments', sessionId);
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(f.fileName).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'file';
  let target = path.join(dir, base);
  let i = 1;
  for (;;) {
    try {
      await fs.access(target);
    } catch {
      break;
    }
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    target = path.join(dir, `${stem}-${i++}${ext}`);
  }
  await fs.writeFile(target, Buffer.from(f.data, 'base64'));
  return target;
}