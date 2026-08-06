/**
 * 端到端测试 - 真实模型 + 真实工具调用
 *
 * 用 sensenova-6.7-flash-lite 模型测试：
 *  1. 加载配置
 *  2. 创建 AgentContext
 *  3. 简单对话
 *  4. 工具调用 (Bash + Glob + Read + Write)
 *  5. 多步骤对话
 */
import {
  loadMergedConfig,
  createBuiltinRegistry,
  createAdapter,
  inferProvider,
  PermissionEngine,
  SessionManager,
  ContextCompressor,
  AgentRunner,
  loadRules,
  buildSystemPrompt,
} from '@codix/core';
import path from 'node:path';
import os from 'node:os';

async function main(): Promise<void> {
  console.log('=== 端到端测试：真实模型 ===\n');

  // 临时 cwd
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codix-e2e-'));
  console.log('[setup] cwd:', cwd);

  // 1. 加载配置
  const cfg = await loadMergedConfig(cwd);
  console.log('[setup] 模型:', Object.keys(cfg.models).join(', '));
  console.log('[setup] 默认:', cfg.defaultModel);

  // 2. 创建适配器
  const key = cfg.defaultModel!;
  const modelCfg = cfg.models[key];
  const model = createAdapter({ ...modelCfg, provider: modelCfg.provider ?? inferProvider(modelCfg.model) });
  console.log('[setup] adapter:', modelCfg.provider, modelCfg.model);

  // 3. 创建 registry
  const registry = createBuiltinRegistry(cfg);
  const tools = registry.list();
  console.log('[setup] 工具:', tools.map((t) => t.schema.name).join(', '));

  // 4. 权限引擎
  const perm = new PermissionEngine(cfg);

  // 5. Session manager
  const sm = new SessionManager({ baseDir: path.join(cwd, '.codix', 'sessions') });
  const session = await sm.create({ cwd, title: 'e2e test' });
  console.log('[setup] session:', session.id);

  // 6. 规则
  const rules = await loadRules(cwd);

  // 7. system prompt
  const systemPrompt = buildSystemPrompt({
    identity: 'You are codix, an AI coding assistant. Be concise. Reply in user\'s language.',
    tools: tools.map((t) => `- ${t.schema.name}: ${t.schema.description}`).join('\n'),
    rules: rules.combined,
  });

  console.log('\n[test 1] 简单对话');
  console.log('  Q: 用一句话介绍你自己。');
  let runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: session.id, systemPrompt, maxSteps: 5 });
  let msgs = await runner.run({ messages: [], userInput: { text: '用一句话介绍你自己。' } });
  let last = msgs[msgs.length - 1];
  console.log('  A:', typeof last.content === 'string' ? last.content.slice(0, 200) : '(non-text)');

  console.log('\n[test 2] Glob 工具调用');
  // 先创建一个测试文件
  await fs.writeFile(path.join(cwd, 'hello.txt'), 'Hello, World!');
  await fs.writeFile(path.join(cwd, 'main.ts'), 'export const x = 1;');

  const session2 = await sm.create({ cwd, title: 'glob test' });
  runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: session2.id, systemPrompt, maxSteps: 5 });
  msgs = await runner.run({ messages: [], userInput: { text: '用 Glob 工具查找当前目录下所有 .ts 文件' } });
  for (const m of msgs) {
    if (m.toolCalls?.length) console.log('  → 调用工具:', m.toolCalls.map((t) => t.name).join(', '));
    if (m.toolResult) console.log('  ← 结果:', m.toolResult.content.slice(0, 150).replace(/\n/g, ' '));
    if (typeof m.content === 'string' && m.content) console.log('  💬', m.content.slice(0, 200));
  }

  console.log('\n[test 3] Bash 工具调用');
  const session3 = await sm.create({ cwd, title: 'bash test' });
  runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: session3.id, systemPrompt, maxSteps: 5 });
  msgs = await runner.run({ messages: [], userInput: { text: '用 Bash 工具执行 echo 命令，输出 "hello from bash"' } });
  for (const m of msgs) {
    if (m.toolCalls?.length) console.log('  → 调用工具:', m.toolCalls.map((t) => t.name).join(', '));
    if (m.toolResult) console.log('  ← 结果:', m.toolResult.content.slice(0, 200).replace(/\n/g, ' '));
    if (typeof m.content === 'string' && m.content) console.log('  💬', m.content.slice(0, 200));
  }

  console.log('\n[test 4] Read 工具调用');
  const session4 = await sm.create({ cwd, title: 'read test' });
  runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: session4.id, systemPrompt, maxSteps: 5 });
  msgs = await runner.run({ messages: [], userInput: { text: '用 Read 工具读取 hello.txt 的内容并告诉我里面写了什么' } });
  for (const m of msgs) {
    if (m.toolCalls?.length) console.log('  → 调用工具:', m.toolCalls.map((t) => t.name).join(', '));
    if (m.toolResult) console.log('  ← 结果:', m.toolResult.content.slice(0, 200).replace(/\n/g, ' '));
    if (typeof m.content === 'string' && m.content) console.log('  💬', m.content.slice(0, 200));
  }

  console.log('\n[test 5] Write 工具调用');
  const targetFile = path.join(cwd, 'created-by-agent.md');
  const session5 = await sm.create({ cwd, title: 'write test' });
  runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: session5.id, systemPrompt, maxSteps: 5 });
  msgs = await runner.run({ messages: [], userInput: { text: `用 Write 工具在当前目录创建 created-by-agent.md，内容是 "# Created by Agent\\n\\nThis file was created by codix agent."` } });
  for (const m of msgs) {
    if (m.toolCalls?.length) console.log('  → 调用工具:', m.toolCalls.map((t) => t.name).join(', '));
    if (m.toolResult) console.log('  ← 结果:', m.toolResult.content.slice(0, 200).replace(/\n/g, ' '));
    if (typeof m.content === 'string' && m.content) console.log('  💬', m.content.slice(0, 200));
  }
  // 验证文件确实被创建
  const exists = await fs.access(targetFile).then(() => true).catch(() => false);
  if (exists) {
    const content = await fs.readFile(targetFile, 'utf8');
    console.log('  ✓ 文件已创建，内容:', content.slice(0, 100));
  } else {
    console.log('  ✗ 文件未被创建！');
  }

  console.log('\n=== 端到端测试完成 ===');
}

import fs from 'node:fs/promises';
main().catch((e) => {
  console.error(e);
  process.exit(1);
});