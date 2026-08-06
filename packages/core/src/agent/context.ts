/**
 * Agent 上下文工厂 - 把 core 的各个组件组装成可运行的 Agent 环境
 */
import {
  loadMergedConfig,
  createBuiltinRegistry,
  createAdapter,
  inferProvider,
  resolveModelConfig,
  PermissionEngine,
  loadRules,
  buildSystemPrompt,
  McpManager,
  registerMcpTools,
  SkillManager,
  SkillInstaller,
  ensureDefaultSkills,
  SessionManager,
  ContextCompressor,
  AgentRunner,
  buildUserMessage,
  type ModelAdapter,
  type ToolDefinition,
  type GlobalConfig,
  type McpServerStatus,
  type UserInput,
  type Message,
  type ToolUse,
  type ToolResult,
  type StreamEvent,
  type PermissionAskRequest,
  type AgentCallbacks,
} from '../index.js';

export interface AgentContext {
  cwd: string;
  config: GlobalConfig;
  model: ModelAdapter;
  tools: ToolDefinition[];
  permission: PermissionEngine;
  rules: string;
  skillPrompts: string;
  mcp: McpManager;
  skills: SkillManager;
  skillInstaller: SkillInstaller;
  sessions: SessionManager;
  systemPrompt: string;
}

export async function createAgentContext(
  cwd: string,
  opts: { modelKey?: string } = {}
): Promise<AgentContext> {
  const config = await loadMergedConfig(cwd);
  const defaultKey = opts.modelKey ?? config.defaultModel ?? Object.keys(config.models)[0];
  if (!defaultKey || !config.models[defaultKey]) {
    throw new Error(
      '没有配置模型。请先在 ~/.codix/config.json 中配置 models，或设置环境变量 CODIX_API_KEY + CODIX_MODEL'
    );
  }
  const modelCfg = resolveModelConfig(config.models[defaultKey], config.providers);
  const model = createAdapter({ ...modelCfg, provider: modelCfg.provider ?? inferProvider(modelCfg.model) });

  const registry = createBuiltinRegistry(config);
  const mcp = new McpManager();
  const mcpStatuses: McpServerStatus[] = [];
  for (const s of config.mcpServers ?? []) {
    if (s.autoConnect ?? true) {
      const status = await mcp.connect(s);
      if (status.connected) registerMcpTools(registry, mcp, s.name);
      mcpStatuses.push(status);
    }
  }
  const skills = new SkillManager(registry);
  const skillInstaller = new SkillInstaller(skills, registry);
  // 首次运行自动安装默认推荐 skill（如 find-skills）；失败不阻断启动
  await ensureDefaultSkills(skillInstaller).catch(() => {});
  const listSkills = await skills.listSkills(cwd);
  for (const sk of listSkills) await skills.registerTools(sk);
  const skillPrompts = await skills.collectPrompts(cwd);

  const permission = new PermissionEngine(config);
  const rulesObj = await loadRules(cwd);

  const tools = registry.list();
  const sessions = new SessionManager();

  const systemPrompt = buildSystemPrompt({
    identity:
      "You are codix, an AI coding assistant that can read/write/edit files, run shell commands, search the web, and use tools. Be concise. Use tools to answer questions when needed. " +
      "You are NOT confined to any directory. The filesystem tools accept ABSOLUTE paths to ANY location on this machine " +
      "(for example C:\\\\Users\\\\<user>\\\\Desktop, /Users/<user>, /tmp) — there is no sandbox and no cwd boundary. " +
      "The `cwd` shown in tool parameters is only a convenience default for RELATIVE paths. " +
      "When the user references any path, call the appropriate tool with that exact path; " +
      "never refuse, and never claim you can only access cwd or that a path is 'outside allowed directories'.",
    tools: tools.map((t) => `- ${t.schema.name}: ${t.schema.description}`).join('\n'),
    rules: rulesObj.combined,
    skills: skillPrompts,
  });

  return {
    cwd,
    config,
    model,
    tools,
    permission,
    rules: rulesObj.combined,
    skillPrompts,
    mcp,
    skills,
    skillInstaller,
    sessions,
    systemPrompt,
  };
}

export interface AgentRunOptions {
  onEvent?: (ev: StreamEvent) => void;
  onAssistantStart?: () => void;
  onToolStart?: (call: ToolUse) => void;
  onToolEnd?: (call: ToolUse, result: ToolResult) => void;
  onPermissionAsk?: (req: PermissionAskRequest) => Promise<'allow' | 'deny' | 'allowAll'>;
  abortSignal?: AbortSignal;
}

export interface AgentRunHandle {
  abort: () => void;
  promise: Promise<{ messages: Message[] }>;
}

export function runAgent(
  ctx: AgentContext,
  sessionId: string,
  userInput: UserInput,
  opts: AgentRunOptions = {}
): AgentRunHandle {
  const controller = new AbortController();
  const signal = opts.abortSignal ?? controller.signal;
  // 双向 abort：调用 handle.abort() 同时取消外部信号
  if (opts.abortSignal) {
    opts.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const compressor = new ContextCompressor(ctx.model, { thresholdChars: 120_000, preserveLast: 8 });

  const promise = (async () => {
    const session = await ctx.sessions.load(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    const callbacks: AgentCallbacks = {
      onEvent: opts.onEvent,
      onAssistantStart: opts.onAssistantStart,
      onToolStart: opts.onToolStart,
      onToolEnd: opts.onToolEnd,
      onPermissionAsk: opts.onPermissionAsk,
    };
    const runner = new AgentRunner({
      model: ctx.model,
      tools: ctx.tools,
      permission: ctx.permission,
      compressor,
      cwd: ctx.cwd,
      sessionId,
      signal,
      systemPrompt: ctx.systemPrompt,
      callbacks,
    });
    // 先把 user 消息落盘：确保「切走再切回」时用户自己的输入不会丢失（即便 run 中途被中断也不影响）
    const baseMessages = session.messages;
    let runMessages = baseMessages;
    if (userInput) {
      const userMsg = await buildUserMessage(userInput, sessionId);
      await ctx.sessions.appendMessage(sessionId, userMsg);
      runMessages = [...baseMessages, userMsg];
    }
    const messages = await runner.run({ messages: runMessages, userInput: undefined });
    // 持久化 assistant/tool 消息（user 消息已提前落盘，从 runMessages.length 起算，避免重复）
    const newMessages = messages.slice(runMessages.length);
    for (const m of newMessages) {
      if (signal.aborted) break;
      await ctx.sessions.appendMessage(sessionId, m);
    }
    return { messages };
  })();

  return {
    abort: () => controller.abort(),
    promise,
  };
}

/**
 * 重新运行某一轮对话。
 *
 * 用于桌面端的「编辑重发」和「重新回复」：
 * - 找到 userMessageId 对应的 user 消息；
 * - 将会话截断到该消息（含），可选把内容改写为新文本；
 * - 重新跑 AgentRunner（不再追加新的 user 消息），把新生成的 assistant/tool 消息持久化。
 *
 * 这样旧的那一轮 AI 回复（及其后的所有消息）会被新回复覆盖。
 */
export function rerunTurn(
  ctx: AgentContext,
  sessionId: string,
  userMessageId: string,
  opts: AgentRunOptions = {},
  text?: string,
): AgentRunHandle {
  const controller = new AbortController();
  const signal = opts.abortSignal ?? controller.signal;
  if (opts.abortSignal) {
    opts.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const compressor = new ContextCompressor(ctx.model, { thresholdChars: 120_000, preserveLast: 8 });

  const promise = (async () => {
    const session = await ctx.sessions.load(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    const idx = session.messages.findIndex((m) => m.id === userMessageId);
    if (idx < 0) throw new Error('Message not found: ' + userMessageId);
    if (session.messages[idx].role !== 'user') {
      throw new Error('rerunTurn 需要一个 user 消息的 id');
    }
    // 截断到该 user 消息（含）；可改写其内容
    const trimmed = session.messages.slice(0, idx + 1).map((m) => ({ ...m }));
    if (text !== undefined) {
      trimmed[idx] = { ...trimmed[idx], content: text } as Message;
    }
    await ctx.sessions.store$().save({ ...session, messages: trimmed });

    const callbacks: AgentCallbacks = {
      onEvent: opts.onEvent,
      onAssistantStart: opts.onAssistantStart,
      onToolStart: opts.onToolStart,
      onToolEnd: opts.onToolEnd,
      onPermissionAsk: opts.onPermissionAsk,
    };
    const runner = new AgentRunner({
      model: ctx.model,
      tools: ctx.tools,
      permission: ctx.permission,
      compressor,
      cwd: ctx.cwd,
      sessionId,
      signal,
      systemPrompt: ctx.systemPrompt,
      callbacks,
    });
    // 不传 userInput：就重跑 user 消息那一轮
    const messages = await runner.run({ messages: trimmed });
    const newMessages = messages.slice(trimmed.length);
    for (const m of newMessages) {
      if (signal.aborted) break;
      await ctx.sessions.appendMessage(sessionId, m);
    }
    return { messages };
  })();

  return {
    abort: () => controller.abort(),
    promise,
  };
}

export { AgentRunner, ContextCompressor, SessionManager };
export type { AgentContext as codixContext };