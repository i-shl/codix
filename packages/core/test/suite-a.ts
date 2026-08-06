/**
 * 高级测试 - Suite A: 功能完整性
 *
 * 测试每个工具在真实模型下的可用性
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  loadMergedConfig,
  createBuiltinRegistry,
  createAdapter,
  inferProvider,
  PermissionEngine,
  SessionManager,
  AgentRunner,
  loadRules,
  buildSystemPrompt,
} from '@voked/core';

const passed: string[] = [];
const failed: string[] = [];

function assert(cond: boolean, label: string): void {
  if (cond) { passed.push(label); console.log(`  ✓ ${label}`); }
  else { failed.push(label); console.log(`  ✗ ${label}`); }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<T | null>((_, reject) => setTimeout(() => reject(new Error('超时')), ms)),
    ]);
  } catch (e) {
    console.log(`  ⚠ ${(e as Error).message}`);
    return null;
  }
}

async function runWithModel(
  model: any, tools: any[], perm: any, sm: any, cwd: string, systemPrompt: string, prompt: string, maxSteps = 4,
): Promise<{ toolCalled: string; hasResult: boolean; hasError: boolean } | null> {
  const sess = await sm.create({ cwd, title: 'auto' });
  const runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: sess.id, systemPrompt, maxSteps });
  const msgs = await withTimeout(runner.run({ messages: [], userInput: { text: prompt } }), 60000);
  if (!msgs) return null;
  // 累积整轮用过的工具：模型经常先 Read 再 Edit，只保留最后一次会误判成没调用 Edit
  const names: string[] = [];
  let hasResult = false;
  let hasError = false;
  for (const m of msgs) {
    if (m.toolCalls?.length) names.push(...m.toolCalls.map((t) => t.name));
    if (m.toolResult) {
      hasResult = true;
      if (m.toolResult.isError) hasError = true;
    }
  }
  return { toolCalled: names.join(','), hasResult, hasError };
}

async function main(): Promise<void> {
  console.log('=== Suite A: 功能完整性（每个工具独立测试）===\n');

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'voked-a-'));
  console.log('[setup] cwd:', cwd);

  const cfg = await loadMergedConfig(cwd);
  const modelCfg = cfg.models[cfg.defaultModel!];
  const model = createAdapter({ ...modelCfg, provider: modelCfg.provider ?? inferProvider(modelCfg.model) });
  const registry = createBuiltinRegistry(cfg);
  const tools = registry.list();
  const perm = new PermissionEngine(cfg);
  const sm = new SessionManager({ baseDir: path.join(cwd, '.voked', 'sessions') });
  const rules = await loadRules(cwd);
  const systemPrompt = buildSystemPrompt({
    identity: 'You are voked. Be concise.',
    tools: tools.map((t) => `- ${t.schema.name}: ${t.schema.description}`).join('\n'),
    rules: rules.combined,
  });

  // 预置测试文件
  await fs.writeFile(path.join(cwd, 'a-readme.md'), '# Test\nHello');
  await fs.mkdir(path.join(cwd, 'a-list'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'a-list', 'file1.ts'), '');
  await fs.mkdir(path.join(cwd, 'a-list', 'sub'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'a-list', 'sub', 'file2.ts'), '');
  await fs.writeFile(path.join(cwd, 'a-edit.txt'), 'hello world');

  // A1: Read
  console.log('\n[A1] Read');
  let r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 Read 工具读取 a-readme.md 的内容');
  assert(r !== null && /Read/i.test(r.toolCalled) && r.hasResult && !r.hasError, 'Read 工具可用');

  // A2: Write
  console.log('\n[A2] Write');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 Write 工具创建 a-new.txt，内容是"hi"');
  assert(r !== null && /Write/i.test(r.toolCalled) && r.hasResult && !r.hasError, 'Write 工具可用');
  const newExists = await fs.access(path.join(cwd, 'a-new.txt')).then(() => true).catch(() => false);
  assert(newExists, 'Write 实际创建了文件');

  // A3: Edit
  console.log('\n[A3] Edit');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 Edit 工具把 a-edit.txt 中 hello 改为 bye');
  assert(r !== null && /Edit/i.test(r.toolCalled) && r.hasResult && !r.hasError, 'Edit 工具可用');
  const edited = await fs.readFile(path.join(cwd, 'a-edit.txt'), 'utf8').catch(() => '');
  assert(edited.includes('bye'), 'Edit 实际修改了文件');

  // A4: Bash
  console.log('\n[A4] Bash');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 Bash 执行 echo a-bash-test');
  assert(r !== null && /Bash/i.test(r.toolCalled) && r.hasResult && !r.hasError, 'Bash 工具可用');

  // A5: Glob
  console.log('\n[A5] Glob');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 Glob 工具匹配 a-list/**/*.ts');
  assert(r !== null && /Glob/i.test(r.toolCalled) && r.hasResult && !r.hasError, 'Glob 工具可用');

  // A6: Grep
  console.log('\n[A6] Grep');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 Grep 工具搜索包含 "Test" 的文件');
  assert(r !== null && /Grep/i.test(r.toolCalled) && r.hasResult && !r.hasError, 'Grep 工具可用');

  // A7: LS
  console.log('\n[A7] LS');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 LS 工具列出当前目录');
  assert(r !== null && /LS/i.test(r.toolCalled) && r.hasResult && !r.hasError, 'LS 工具可用');

  // A8: WebFetch（测试外部 URL）
  console.log('\n[A8] WebFetch');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 WebFetch 工具抓取 https://example.com');
  assert(r !== null && /WebFetch/i.test(r.toolCalled), 'WebFetch 工具可调用');

  // A9: WebSearch
  console.log('\n[A9] WebSearch');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 WebSearch 搜索 "hello"');
  assert(r !== null && /WebSearch/i.test(r.toolCalled), 'WebSearch 工具可调用');

  // A10: TodoWrite
  console.log('\n[A10] TodoWrite');
  r = await runWithModel(model, tools, perm, sm, cwd, systemPrompt, '用 TodoWrite 工具创建一个含 3 项的 todo 列表');
  assert(r !== null && /TodoWrite/i.test(r.toolCalled), 'TodoWrite 工具可调用');

  // 总结
  console.log('\n=== Suite A 总结 ===');
  console.log(`✓ 通过: ${passed.length}`);
  console.log(`✗ 失败: ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log('  -', f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});