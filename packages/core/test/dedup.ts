/**
 * 测试 CLI App.tsx 用的消息去重逻辑
 * 复刻 App.tsx 中 setMessages 内的 dedup 逻辑
 */
import type { Message } from '../dist/types/message.js';

const passed: string[] = [];
const failed: string[] = [];
function assert(cond: boolean, label: string): void {
  if (cond) { passed.push(label); console.log(`  ✓ ${label}`); }
  else { failed.push(label); console.log(`  ✗ ${label}`); }
}

/** 复刻 App.tsx 的 dedup 逻辑 */
function mergeRunnerMessages(prev: Message[], result: Message[]): Message[] {
  if (prev.length === 0) return prev;
  const lastUserIdx = (() => {
    for (let i = prev.length - 1; i >= 0; i--) {
      if (prev[i].role === 'user') return i;
    }
    return -1;
  })();
  if (lastUserIdx < 0) return prev;
  const lastUser = prev[lastUserIdx];
  const userPos = result.findIndex(
    (m) => m.role === 'user' && m.content === lastUser.content
  );
  if (userPos < 0) return prev;
  const fresh = result.slice(userPos + 1);
  const seen = new Set(prev.map((m) => m.id));
  const additions = fresh.filter((m) => !seen.has(m.id));
  return additions.length ? [...prev, ...additions] : prev;
}

const lastSubmitRef: { current: { text: string; at: number } | null } = { current: null };

function msg(role: 'user' | 'assistant' | 'tool', content: string, id = `${role}_${Math.random()}`): Message {
  return { id, role, content, meta: { timestamp: 0 } } as Message;
}

console.log('=== dedup 测试 ===\n');

// 1. 用户问完，只 push 自己的 user msg。runner 返回全量。
//    期望：本地追加 1 个 assistant（只新增的那条），不重复历史 assistant
{
  const prev = [msg('user', '你好', 'u_local_1')];
  const result = [
    msg('assistant', '历史回复1', 'a_old_1'),
    msg('user', '你好', 'u_runner_1'),
    msg('assistant', '新的回复', 'a_new_1'),
  ];
  const out = mergeRunnerMessages(prev, result);
  assert(out.length === 2, '本轮只追加 1 条 assistant');
  assert(out[1].content === '新的回复', '追加的是新消息');
}

// 2. 多轮 assistant + tool
{
  const prev = [msg('user', '查文件', 'u_local_2')];
  const result = [
    msg('assistant', '旧的', 'a_old_2'),
    msg('user', '查文件', 'u_runner_2'),
    msg('assistant', '调用工具', 'a_2_1', ),
    msg('tool', '工具结果', 't_2_1'),
    msg('assistant', '完成', 'a_2_2'),
  ];
  const out = mergeRunnerMessages(prev, result);
  assert(out.length === 4, '追加 3 条新消息 (1 user + 1 assistant + 1 tool + 1 assistant)');
  assert(out.map((m) => m.role).join(',') === 'user,assistant,tool,assistant', '顺序正确');
}

// 3. user 消息找不到同内容（罕见，LLM 改写了）→ 不追加
{
  const prev = [msg('user', '原话', 'u_local_3')];
  const result = [msg('user', '改后的话', 'u_runner_3'), msg('assistant', 'OK', 'a_3')];
  const out = mergeRunnerMessages(prev, result);
  assert(out.length === 1, 'user 内容不一致时不追加任何东西');
}

// 4. 空 prev（理论不会发生）→ 不追加
{
  const out = mergeRunnerMessages([], [msg('assistant', 'x', 'a_4')]);
  assert(out.length === 0, '空 prev 返回原样');
}

// 5. 多条 user 消息：找最后一条
{
  const prev = [
    msg('user', '第一问', 'u_local_5a'),
    msg('assistant', '第一答', 'a_5a'),
    msg('user', '第二问', 'u_local_5b'),
  ];
  const result = [
    msg('user', '第一问', 'u_r_5a'),
    msg('assistant', '第一答', 'a_r_5a'),
    msg('user', '第二问', 'u_r_5b'),
    msg('assistant', '第二答', 'a_r_5b'),
  ];
  const out = mergeRunnerMessages(prev, result);
  assert(out.length === 4, '只追加第二问的 assistant');
  assert(out[3].content === '第二答', '是第二答不是第一答');
}

// 6. abort 后：result 包含部分消息（user 一定在最前，assistant 之后）
{
  const prev = [msg('user', '长任务', 'u_local_6')];
  const result = [
    msg('user', '长任务', 'u_r_6'),
    msg('assistant', '已开始', 'a_6_1'),
    msg('assistant', '正在做', 'a_6_2'),
  ];
  const out = mergeRunnerMessages(prev, result);
  assert(out.length === 3, 'abort 后追加已生成的消息 (2 assistant)');
  assert(out[1].content === '已开始' && out[2].content === '正在做', '内容正确');
}

// 7. handleSubmit 重入：500ms 内同 text 第二次调用应被丢弃
{
  let inFlight = false;
  let callCount = 0;
  function shouldAccept(text: string, now: number): boolean {
    if (inFlight) return false;
    if (lastSubmitRef.current && lastSubmitRef.current.text === text && now - lastSubmitRef.current.at < 500) {
      return false;
    }
    lastSubmitRef.current = { text, at: now };
    inFlight = true;
    callCount++;
    return true;
  }
  // 模拟 5ms 内两次相同提交
  const accepted1 = shouldAccept('hello', 1000);
  inFlight = false;
  const accepted2 = shouldAccept('hello', 1005);
  assert(accepted1 && !accepted2, '500ms 内同 text 第二次被丢弃');
}

// 8. 不同 text 在 500ms 内应都通过
{
  let inFlight = false;
  const lastSubmitRef2 = { current: null as { text: string; at: number } | null };
  function shouldAccept(text: string, now: number): boolean {
    if (inFlight) return false;
    if (lastSubmitRef2.current && lastSubmitRef2.current.text === text && now - lastSubmitRef2.current.at < 500) {
      return false;
    }
    lastSubmitRef2.current = { text, at: now };
    inFlight = true;
    return true;
  }
  inFlight = false;
  const a = shouldAccept('first', 1000);
  inFlight = false;
  const b = shouldAccept('second', 1001);
  assert(a && b, '不同 text 在 500ms 内都通过');
}

// 总结
console.log('\n=== 总结 ===');
console.log(`✓ 通过: ${passed.length}`);
console.log(`✗ 失败: ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.log('  -', f);
  process.exit(1);
}
