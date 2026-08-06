/**
 * OpenAI Responses API 适配器 + 连通性测试重试逻辑
 *
 * 覆盖：
 *  1. prepareRequest 用 input/instructions/扁平 tools，工具结果走 function_call_output
 *  2. SSE 语义事件能还原文本、思考、工具调用、usage
 *  3. HTTP 错误会变成 error 事件
 *  4. testModelConnectivity：第一次带 max_tokens 被拒时，会不带上限重试一次
 *     （这正是「能聊天但测试链接失败」的场景）
 *
 * node --experimental-strip-types test/responses-api.ts
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { OpenAIResponsesAdapter, testModelConnectivity } from '@codix/core';
import type { Message, StreamEvent } from '@codix/core';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`  ✗ ${name}`);
  }
}

// ---------------------------------------------------------------- 假服务

/** /responses：吐一串语义化 SSE 事件 */
let responsesEvents: unknown[] = [];
let responsesStatus = 200;

/** /chat/completions：第 N 次之前拒绝带 max_tokens 的请求 */
const chatCalls: Array<Record<string, unknown>> = [];

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    if (req.url?.endsWith('/responses')) {
      if (responsesStatus !== 200) {
        res.writeHead(responsesStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'nope' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const ev of responsesEvents) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (req.url?.endsWith('/chat/completions')) {
      chatCalls.push(body);
      if (body.max_tokens !== undefined) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model." },
          })
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'pong' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.writeHead(404).end();
  });
});

async function drain(adapter: OpenAIResponsesAdapter): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of adapter.stream({ messages: [{ id: 'u', role: 'user', content: 'hi' }] })) {
    out.push(ev);
  }
  return out;
}

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const baseURL = `http://127.0.0.1:${port}/v1`;
  console.log('=== OpenAI Responses API 测试 ===\n');

  // 1. prepareRequest
  const messages: Message[] = [
    { id: '1', role: 'user', content: 'Hi' },
    { id: '2', role: 'assistant', content: 'Hello!', toolCalls: [{ id: 'tc1', name: 'echo', input: { text: 'hi' } }] },
    { id: '3', role: 'tool', content: 'ok', toolResult: { toolCallId: 'tc1', content: 'ok' } },
  ];
  const adapter = new OpenAIResponsesAdapter({ provider: 'openai-responses', model: 'gpt-5', apiKey: 'sk', baseURL });
  const req = adapter.prepareRequest({
    messages,
    system: 'be nice',
    tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }],
  }) as Record<string, any>;

  check('请求体使用 input / instructions 而不是 messages', () => {
    assert.equal(req.messages, undefined);
    assert.equal(req.instructions, 'be nice');
    assert.ok(Array.isArray(req.input));
  });
  check('工具是扁平的 { type, name, parameters }', () => {
    assert.equal(req.tools[0].type, 'function');
    assert.equal(req.tools[0].name, 'echo');
    assert.deepEqual(req.tools[0].parameters, { type: 'object' });
    assert.equal(req.tools[0].function, undefined);
  });
  check('assistant 的工具调用变成 function_call item', () => {
    const fc = req.input.find((i: any) => i.type === 'function_call');
    assert.ok(fc, '缺少 function_call');
    assert.equal(fc.call_id, 'tc1');
    assert.equal(fc.name, 'echo');
    assert.equal(fc.arguments, '{"text":"hi"}');
  });
  check('tool 结果变成 function_call_output item', () => {
    const out = req.input.find((i: any) => i.type === 'function_call_output');
    assert.ok(out, '缺少 function_call_output');
    assert.equal(out.call_id, 'tc1');
    assert.equal(out.output, 'ok');
  });

  // 2. 流式事件还原
  responsesStatus = 200;
  responsesEvents = [
    { type: 'response.reasoning_summary_text.delta', delta: '先想一下' },
    { type: 'response.output_text.delta', delta: '你好' },
    { type: 'response.output_text.delta', delta: '，世界' },
    {
      type: 'response.output_item.added',
      output_index: 1,
      item: { type: 'function_call', call_id: 'call_1', name: 'Read' },
    },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"filePath":' },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '"a.txt"}' },
    { type: 'response.completed', response: { usage: { input_tokens: 11, output_tokens: 22 } } },
  ];
  const evs = await drain(adapter);

  check('文本增量按序还原', () => {
    const text = evs.filter((e) => e.type === 'text_delta').map((e) => (e as any).text).join('');
    assert.equal(text, '你好，世界');
  });
  check('reasoning 增量映射为 thinking_delta', () => {
    const t = evs.filter((e) => e.type === 'thinking_delta').map((e) => (e as any).text).join('');
    assert.equal(t, '先想一下');
  });
  check('function_call 还原出 name 与完整参数', () => {
    const start = evs.find((e) => e.type === 'tool_use_start') as any;
    const end = evs.find((e) => e.type === 'tool_use_end') as any;
    assert.equal(start.id, 'call_1');
    assert.equal(start.name, 'Read');
    assert.deepEqual(end.input, { filePath: 'a.txt' });
  });
  check('usage 被透出', () => {
    const u = evs.find((e) => e.type === 'usage') as any;
    assert.equal(u.input, 11);
    assert.equal(u.output, 22);
  });
  check('有工具调用时 finish 为 tool_use', () => {
    const f = evs[evs.length - 1] as any;
    assert.equal(f.type, 'finish');
    assert.equal(f.reason, 'tool_use');
  });

  // 3. max_output_tokens 截断
  responsesEvents = [
    { type: 'response.output_text.delta', delta: 'abc' },
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
  ];
  const evs2 = await drain(adapter);
  check('被 max_output_tokens 截断时 finish 为 length', () => {
    const f = evs2[evs2.length - 1] as any;
    assert.equal(f.reason, 'length');
  });

  // 4. HTTP 错误
  responsesStatus = 401;
  const evs3 = await drain(adapter);
  check('HTTP 错误产生 error 事件而不是抛异常', () => {
    const err = evs3.find((e) => e.type === 'error') as any;
    assert.ok(err, '应有 error 事件');
    assert.match(err.error.message, /401/);
  });
  responsesStatus = 200;

  // 5. 连通性测试：带 max_tokens 被拒 → 不带上限重试成功
  chatCalls.length = 0;
  const result = await testModelConnectivity({
    provider: 'openai-compatible',
    model: 'reasoner',
    apiKey: 'sk',
    baseURL,
  });
  check('拒绝 max_tokens 的模型仍能测通（自动重试）', () => {
    assert.equal(result.ok, true, `期望通过，实际: ${result.error}`);
    assert.equal(result.sample, 'pong');
    assert.equal(chatCalls.length, 2, `应重试 1 次，实际请求 ${chatCalls.length} 次`);
    assert.equal(chatCalls[0].max_tokens, 16);
    assert.equal(chatCalls[1].max_tokens, undefined);
  });

  // 6. 连通性测试：供应商上的 key/baseURL 会被继承
  chatCalls.length = 0;
  const inherited = await testModelConnectivity(
    { provider: 'openai-compatible', providerId: 'p1', model: 'reasoner' },
    { providers: { p1: { type: 'openai-compatible', apiKey: 'sk', baseURL } } }
  );
  check('模型未填 baseURL 时继承供应商配置', () => {
    assert.equal(inherited.ok, true, `期望通过，实际: ${inherited.error}`);
  });

  await new Promise<void>((r) => server.close(() => r()));

  console.log('');
  if (failures.length) {
    console.error(`✗ ${failures.length} 个用例失败：`);
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log(`✓ Responses API 测试全部通过（${passed} 个用例）`);
}

void main();
