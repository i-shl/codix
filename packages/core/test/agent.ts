/**
 * 端到端测试 - 用 mock 模型验证 Agent 循环
 */
import { AgentRunner, type ModelAdapter, type ModelConfig, type ChatRequest, type ChatResponse, type StreamEvent, PermissionEngine, BaseTool, jsonSchema, ToolRegistry } from '@codix/core';

class MockAdapter implements ModelAdapter {
  readonly config: ModelConfig = { provider: 'openai-compatible', model: 'mock' };
  private responses: Array<{ text?: string; toolCall?: { name: string; input: Record<string, unknown> } }>;
  private callIdx = 0;
  constructor(responses: Array<{ text?: string; toolCall?: { name: string; input: Record<string, unknown> } }>) {
    this.responses = responses;
  }
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    const r = this.responses[Math.min(this.callIdx, this.responses.length - 1)];
    return { text: r.text ?? '', toolCalls: r.toolCall ? [{ id: 'call_' + this.callIdx, name: r.toolCall.name, input: r.toolCall.input }] : [], usage: { input: 10, output: 5 }, finishReason: r.toolCall ? 'tool_use' : 'stop', model: 'mock' };
  }
  async *stream(_req: ChatRequest): AsyncIterable<StreamEvent> {
    this.callIdx++;
    const r = this.responses[Math.min(this.callIdx - 1, this.responses.length - 1)];
    yield { type: 'start', model: 'mock' };
    if (r.toolCall) {
      yield { type: 'tool_use_start', id: 'call_x', name: r.toolCall.name };
      yield { type: 'tool_use_end', id: 'call_x', input: r.toolCall.input };
    } else {
      yield { type: 'text_delta', text: r.text ?? '' };
    }
    yield { type: 'usage', input: 10, output: 5 };
    yield { type: 'finish', reason: r.toolCall ? 'tool_use' : 'stop' };
  }
  prepareRequest(_req: ChatRequest): unknown { return {}; }
  parseResponse?(_raw: unknown): ChatResponse { return {} as ChatResponse; }
}

class EchoTool extends BaseTool<{ text: string }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema('Echo', '回显输入', { text: { type: 'string' } }, ['text']);
  async execute(input: { text: string }): Promise<{ toolCallId: string; content: string }> {
    return { toolCallId: '', content: `echo: ${input.text}` };
  }
}

async function main(): Promise<void> {
  console.log('=== Agent End-to-End Test ===\n');

  const reg = new ToolRegistry();
  reg.register(new EchoTool());

  const cfg = {
    models: {},
    permissionRules: [{ tool: 'Echo', decision: 'allow' as const }],
    mcpServers: [],
  };

  const perm = new PermissionEngine(cfg);

  // 测试 1：纯文本响应
  console.log('[Test 1] 纯文本响应');
  const adapter1 = new MockAdapter([{ text: '你好！这是模型回复。' }]);
  const runner1 = new AgentRunner({
    model: adapter1,
    tools: reg.list(),
    permission: perm,
    cwd: '.',
    sessionId: 'sess_1',
    systemPrompt: 'You are a helper.',
  });
  const msgs1 = await runner1.run({ messages: [], userInput: { text: '你好' } });
  console.log('  Messages:', msgs1.length);
  const last1 = msgs1[msgs1.length - 1];
  console.log('  Last role:', last1.role);
  console.log('  Last content:', JSON.stringify(last1.content));

  // 测试 2：工具调用 - 模型先调用工具，然后看到结果后给最终回复
  console.log('\n[Test 2] 工具调用 + 后续回复');
  const adapter2 = new MockAdapter([
    { toolCall: { name: 'Echo', input: { text: 'hello' } } },
    { text: '我已经调用了 Echo 工具，回显了 hello。' },
  ]);
  const runner2 = new AgentRunner({
    model: adapter2,
    tools: reg.list(),
    permission: perm,
    cwd: '.',
    sessionId: 'sess_2',
    systemPrompt: 'You are a helper.',
    maxSteps: 5,
  });
  const msgs2 = await runner2.run({ messages: [], userInput: { text: 'echo hello' } });
  console.log('  Messages:', msgs2.length);
  for (const m of msgs2) {
    console.log('  -', m.role, m.toolCalls ? `[${m.toolCalls.map((t) => t.name).join(',')}]` : '');
    if (m.toolResult) console.log('    result:', m.toolResult.content);
    if (typeof m.content === 'string' && m.content) console.log('    text:', m.content.slice(0, 80));
  }

  console.log('\n=== All Agent Tests Passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});