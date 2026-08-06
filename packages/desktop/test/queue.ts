/**
 * 对话轮次队列测试
 *
 * 复现并锁死这个 bug：AI 正在回复时连发 3 条消息，第一轮结束后
 * 3 条应当**逐条**发出（每条都等上一条回复完），而不是一起飞出去。
 *
 * node --experimental-strip-types test/queue.ts
 */
import assert from 'node:assert/strict';
import { useTurnQueue } from '../renderer/src/useTurnQueue.ts';

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
    console.log(`  ✗ ${name}  -> ${(e as Error).message}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Msg {
  text: string;
}

/** 造一个可控的 runTurn：记录并发峰值与执行顺序 */
function makeRunner(delay = 20): {
  runTurn: (m: Msg) => Promise<void>;
  order: string[];
  maxConcurrent: () => number;
} {
  const order: string[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    order,
    maxConcurrent: () => peak,
    runTurn: async (m: Msg) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      order.push('start:' + m.text);
      await sleep(delay);
      order.push('end:' + m.text);
      inFlight--;
    },
  };
}

async function main(): Promise<void> {
  console.log('=== 桌面端消息队列测试 ===\n');

  await check('AI 回复中连发 3 条：逐条串行，永不并发', async () => {
    const r = makeRunner(30);
    const q = useTurnQueue<Msg>({ runTurn: r.runTurn });

    // 第一条开始跑（不 await，模拟 AI 正在回复）
    const first = q.send({ text: 'a' });
    await sleep(5);
    assert.equal(q.busy.value, true, '第一轮应处于 busy');

    // 用户连发 3 条
    const rest = Promise.all([q.send({ text: 'b' }), q.send({ text: 'c' }), q.send({ text: 'd' })]);
    await sleep(5);
    assert.equal(q.queue.value.length, 3, `应有 3 条排队，实际 ${q.queue.value.length}`);

    await Promise.all([first, rest]);

    assert.equal(r.maxConcurrent(), 1, `同时最多 1 轮，实际峰值 ${r.maxConcurrent()}`);
    assert.deepEqual(r.order, [
      'start:a', 'end:a',
      'start:b', 'end:b',
      'start:c', 'end:c',
      'start:d', 'end:d',
    ]);
    assert.equal(q.queue.value.length, 0, '结束后队列应清空');
    assert.equal(q.busy.value, false, '结束后应不再 busy');
  });

  await check('两轮之间 busy 不会闪回 false（不会给并发留空窗）', async () => {
    const states: boolean[] = [];
    const q = useTurnQueue<Msg>({
      runTurn: async () => {
        states.push(q.busy.value);
        await sleep(10);
        states.push(q.busy.value);
      },
    });
    const p = q.send({ text: '1' });
    await q.send({ text: '2' });
    await p;
    assert.ok(states.every((s) => s === true), `每轮内 busy 都应为 true，实际 ${JSON.stringify(states)}`);
  });

  await check('某一轮抛错不会卡死队列，后续消息照常发出', async () => {
    const done: string[] = [];
    const errs: string[] = [];
    const q = useTurnQueue<Msg>({
      runTurn: async (m) => {
        await sleep(5);
        if (m.text === 'boom') throw new Error('模型炸了');
        done.push(m.text);
      },
      onError: (e, m) => errs.push(`${m.text}:${(e as Error).message}`),
    });
    const first = q.send({ text: 'boom' });
    const second = q.send({ text: 'ok' });
    await Promise.all([first, second]);
    assert.deepEqual(done, ['ok'], '失败的那一轮不应吞掉后面的消息');
    assert.deepEqual(errs, ['boom:模型炸了'], 'onError 应收到失败信息');
    assert.equal(q.busy.value, false);
  });

  await check('排队中的消息可以被取消，不会被执行', async () => {
    const r = makeRunner(25);
    const q = useTurnQueue<Msg>({ runTurn: r.runTurn });
    const first = q.send({ text: 'a' });
    await sleep(5);
    const rest = Promise.all([q.send({ text: 'b' }), q.send({ text: 'c' })]);
    await sleep(5);
    q.cancel(0); // 取消 b
    await Promise.all([first, rest]);
    assert.ok(!r.order.includes('start:b'), 'b 已取消，不应执行');
    assert.ok(r.order.includes('start:c'), 'c 应仍然执行');
  });

  await check('before() 只执行一次（连点不会创建多个会话）', async () => {
    let created = 0;
    const r = makeRunner(10);
    const q = useTurnQueue<Msg>({
      runTurn: r.runTurn,
      before: async () => {
        await sleep(15);
        created++;
        return true;
      },
    });
    await Promise.all([q.send({ text: 'a' }), q.send({ text: 'b' }), q.send({ text: 'c' })]);
    assert.equal(created, 1, `before 应只跑 1 次，实际 ${created} 次`);
    assert.equal(r.maxConcurrent(), 1);
  });

  await check('before() 返回 false 时消息被丢弃', async () => {
    const r = makeRunner(5);
    const q = useTurnQueue<Msg>({ runTurn: r.runTurn, before: async () => false });
    await q.send({ text: 'a' });
    assert.equal(r.order.length, 0);
    assert.equal(q.queue.value.length, 0);
  });

  console.log('');
  if (failures.length) {
    console.error(`✗ ${failures.length} 个用例失败：`);
    for (const x of failures) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log(`✓ 队列测试全部通过（${passed} 个用例）`);
}

void main();
