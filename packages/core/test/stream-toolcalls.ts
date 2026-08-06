/**
 * OpenAI 兼容适配器的流式 tool_calls 累积测试
 *
 * 各家服务吐 tool_calls 增量的形状差别很大：
 *  - 官方：首块带 id + name，后续块只有 index + arguments 片段
 *  - 部分兼容服务：每一块都重复同一个 id
 *  - 部分兼容服务：完全不带 index
 *  - 并行调用：同一次响应里出现多个 index
 * 这里用本地假服务把这几种都跑一遍，确保最终都还原成正确的 name + input。
 *
 * node --experimental-strip-types test/stream-toolcalls.ts
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { OpenAICompatibleAdapter } from '@codix/core';

type Delta = Record<string, unknown>;

let chunks: Delta[] = [];

const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const d of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ finish_reason: 'tool_calls' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

interface Collected {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

async function collect(deltas: Delta[], port: number): Promise<Collected[]> {
  chunks = deltas;
  const adapter = new OpenAICompatibleAdapter({
    provider: 'openai-compatible',
    model: 'test',
    apiKey: 'sk-test',
    baseURL: `http://127.0.0.1:${port}/v1`,
  });
  const byId = new Map<string, Collected>();
  const order: string[] = [];
  for await (const ev of adapter.stream({ messages: [] })) {
    if (ev.type === 'tool_use_start') {
      if (!byId.has(ev.id)) order.push(ev.id);
      byId.set(ev.id, { id: ev.id, name: ev.name, input: {} });
    } else if (ev.type === 'tool_use_end') {
      const cur = byId.get(ev.id);
      if (cur) cur.input = ev.input;
    }
  }
  return order.map((id) => byId.get(id)!);
}

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

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  console.log('=== 流式 tool_calls 累积测试 ===\n');

  // 1. 官方形状：首块 id + name，后续只有 index
  const a = await collect(
    [
      { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'echo', arguments: '' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '{"text":' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] },
    ],
    port
  );
  check('官方形状：name 与分段 arguments 正确还原', () => {
    assert.equal(a.length, 1);
    assert.equal(a[0].name, 'echo');
    assert.deepEqual(a[0].input, { text: 'hi' });
  });

  // 2. 每块都重复 id —— 这是之前把一次调用拆成三次「未知工具」的元凶
  const b = await collect(
    [
      { tool_calls: [{ index: 0, id: 'call_b', function: { name: 'echo', arguments: '' } }] },
      { tool_calls: [{ index: 0, id: 'call_b', function: { arguments: '{"text":' } }] },
      { tool_calls: [{ index: 0, id: 'call_b', function: { arguments: '"dup"}' } }] },
    ],
    port
  );
  check('重复 id 的增量不会被拆成多次调用', () => {
    assert.equal(b.length, 1, `应只有 1 次调用，实际 ${b.length}`);
    assert.equal(b[0].name, 'echo');
    assert.deepEqual(b[0].input, { text: 'dup' });
  });

  // 3. 完全不带 index
  const c = await collect(
    [
      { tool_calls: [{ id: 'call_c', function: { name: 'echo', arguments: '{"text"' } }] },
      { tool_calls: [{ function: { arguments: ':"noindex"}' } }] },
    ],
    port
  );
  check('缺少 index 时按 id / 上一次调用续接', () => {
    assert.equal(c.length, 1);
    assert.equal(c[0].name, 'echo');
    assert.deepEqual(c[0].input, { text: 'noindex' });
  });

  // 4. 并行调用
  const d = await collect(
    [
      { tool_calls: [{ index: 0, id: 'call_d0', function: { name: 'Read', arguments: '{"filePath":' } }] },
      { tool_calls: [{ index: 1, id: 'call_d1', function: { name: 'LS', arguments: '{"dirPath":' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] },
      { tool_calls: [{ index: 1, function: { arguments: '"."}' } }] },
    ],
    port
  );
  check('并行调用按 index 分别累积', () => {
    assert.equal(d.length, 2);
    assert.equal(d[0].name, 'Read');
    assert.deepEqual(d[0].input, { filePath: 'a.txt' });
    assert.equal(d[1].name, 'LS');
    assert.deepEqual(d[1].input, { dirPath: '.' });
  });

  // 5. 一块给全（非流式风格）
  const e = await collect(
    [{ tool_calls: [{ index: 0, id: 'call_e', function: { name: 'echo', arguments: '{"text":"once"}' } }] }],
    port
  );
  check('单块完整调用', () => {
    assert.equal(e.length, 1);
    assert.equal(e[0].name, 'echo');
    assert.deepEqual(e[0].input, { text: 'once' });
  });

  // 6. name 被拆成两块（少数服务会这么干）
  const f = await collect(
    [
      { tool_calls: [{ index: 0, id: 'call_f', function: { name: 'ec', arguments: '' } }] },
      { tool_calls: [{ index: 0, function: { name: 'ho', arguments: '{}' } }] },
    ],
    port
  );
  check('分片的 name 会拼接完整', () => {
    assert.equal(f.length, 1);
    assert.equal(f[0].name, 'echo');
  });

  // 7. 参数不是合法 JSON 时不抛，降级成 _raw
  const g = await collect(
    [{ tool_calls: [{ index: 0, id: 'call_g', function: { name: 'echo', arguments: '{broken' } }] }],
    port
  );
  check('非法 JSON 参数降级成 _raw 而不是抛异常', () => {
    assert.equal(g.length, 1);
    assert.deepEqual(g[0].input, { _raw: '{broken' });
  });

  await new Promise<void>((r) => server.close(() => r()));

  console.log('');
  if (failures.length) {
    console.error(`✗ ${failures.length} 个用例失败：`);
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log(`✓ 流式 tool_calls 测试全部通过（${passed} 个用例）`);
}

void main();
