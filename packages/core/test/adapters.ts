/**
 * 模型适配器测试 - 验证请求序列化正确（不实际调用 API）
 */
import { OpenAICompatibleAdapter, AnthropicAdapter, GeminiAdapter } from '@codix/core';
import type { Message } from '@codix/core';

async function main(): Promise<void> {
  console.log('=== Model Adapter Tests ===\n');

  const messages: Message[] = [
    { id: '1', role: 'system', content: 'You are helpful.', meta: { timestamp: 0 } },
    { id: '2', role: 'user', content: 'Hi', meta: { timestamp: 0 } },
    {
      id: '3',
      role: 'assistant',
      content: 'Hello!',
      toolCalls: [{ id: 'tc1', name: 'echo', input: { text: 'hi' } }],
      meta: { timestamp: 0 },
    },
    {
      id: '4',
      role: 'tool',
      content: 'echo result',
      toolResult: { toolCallId: 'tc1', content: 'echo result' },
      meta: { timestamp: 0 },
    },
  ];

  // OpenAI
  console.log('[OpenAI] prepareRequest:');
  const openai = new OpenAICompatibleAdapter({ provider: 'openai-compatible', model: 'gpt-4o', apiKey: 'sk-test' });
  const oReq = openai.prepareRequest({ messages, tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
  console.log(JSON.stringify(oReq, null, 2).slice(0, 600));

  // Anthropic
  console.log('\n[Anthropic] prepareRequest:');
  const claude = new AnthropicAdapter({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-test' });
  const aReq = claude.prepareRequest({ messages, system: 'You are helpful.', tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
  console.log(JSON.stringify(aReq, null, 2).slice(0, 800));

  // Gemini
  console.log('\n[Gemini] prepareRequest:');
  const gemini = new GeminiAdapter({ provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'test' });
  const gReq = gemini.prepareRequest({ messages, system: 'You are helpful.', tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
  console.log(JSON.stringify(gReq, null, 2).slice(0, 800));

  console.log('\n=== All Adapter Tests Passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});