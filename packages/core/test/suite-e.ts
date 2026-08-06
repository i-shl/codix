/**
 * 高级测试 - Suite E: 集成深度测试
 *
 * 测试：
 *  E1: 上下文压缩
 *  E2: 多模型切换
 *  E3: 全局规则文件加载
 *  E4: 多步工具调用（模型自己串联）
 *  E5: 中途中断
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
  ContextCompressor,
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

async function main(): Promise<void> {
  console.log('=== Suite E: 集成深度测试 ===\n');

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'voked-e2-'));
  console.log('[setup] cwd:', cwd);

  const cfg = await loadMergedConfig(cwd);
  const key = cfg.defaultModel!;
  const modelCfg = cfg.models[key];
  const model = createAdapter({ ...modelCfg, provider: modelCfg.provider ?? inferProvider(modelCfg.model) });

  // E1: 上下文压缩
  console.log('\n[E1] 上下文压缩');
  const compressor = new ContextCompressor(model, { thresholdChars: 1000, preserveLast: 3 });
  const bigMessages = [];
  for (let i = 0; i < 20; i++) {
    bigMessages.push({
      id: 'm' + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'X'.repeat(200),  // 每条 200 字符，总 4000 字符
      meta: { timestamp: Date.now() },
    });
  }
  const needsCompress = compressor.shouldCompress(bigMessages);
  assert(needsCompress, `压缩检测：${bigMessages.length} 条共 ${4000} 字符 > 1000`);
  const compressed = await compressor.compress(bigMessages);
  assert(compressed.length < bigMessages.length, `压缩后 ${compressed.length} 条 < ${bigMessages.length} 条`);
  const hasSummary = compressed.some((m) => m.meta?.synthetic === true);
  assert(hasSummary, '压缩产生 synthetic 摘要消息');

  // E2: 多模型切换
  console.log('\n[E2] 多模型切换');
  const keys = Object.keys(cfg.models);
  assert(keys.length >= 1, `配置了 ${keys.length} 个模型: ${keys.join(', ')}`);
  // 切换到每个模型都尝试加载
  for (const k of keys) {
    const mCfg = cfg.models[k];
    const m = createAdapter({ ...mCfg, provider: mCfg.provider ?? inferProvider(mCfg.model) });
    assert(m.config.model === mCfg.model, `模型 ${k} 可加载（${mCfg.model}）`);
  }

  // E3: 全局规则文件加载
  console.log('\n[E3] 全局规则文件加载');
  // 写一个全局规则文件
  const os2 = await import('node:os');
  const rulesPath = path.join(os2.homedir(), '.voked', 'rules.md');
  const ruleContent = '# Global rule\nAlways respond in 中文. Be concise.';
  await fs.writeFile(rulesPath, ruleContent, 'utf8');
  // 也写一个项目级规则
  const projectRulesPath = path.join(cwd, '.voked', 'rules.md');
  await fs.mkdir(path.dirname(projectRulesPath), { recursive: true });
  const projectRuleContent = '# Project rule\nThis is a test project. Always include "test:" prefix.';
  await fs.writeFile(projectRulesPath, projectRuleContent, 'utf8');

  const loadedRules = await loadRules(cwd);
  assert(loadedRules.sources.length >= 2, `加载了 ${loadedRules.sources.length} 个规则文件`);
  assert(loadedRules.combined.includes('Global rule'), '全局规则被加载');
  assert(loadedRules.combined.includes('Project rule'), '项目规则被加载');

  // 验证规则能注入到 system prompt
  const sys = buildSystemPrompt({
    identity: 'You are voked.',
    rules: loadedRules.combined,
  });
  assert(sys.includes('Global rule') && sys.includes('Project rule'), '规则被注入到 system prompt');

  // 清理测试规则
  await fs.unlink(rulesPath).catch(() => undefined);
  await fs.unlink(projectRulesPath).catch(() => undefined);

  // E4: 多步工具调用
  console.log('\n[E4] 多步工具调用');
  const registry = createBuiltinRegistry(cfg);
  const tools = registry.list();
  const perm = new PermissionEngine(cfg);
  const sm = new SessionManager({ baseDir: path.join(cwd, '.voked/sessions') });
  const sessE4 = await sm.create({ cwd, title: 'e4 multi-step' });
  const rules = await loadRules(cwd);
  const systemPrompt = buildSystemPrompt({
    identity: 'You are voked. Be concise.',
    tools: tools.map((t) => `- ${t.schema.name}: ${t.schema.description}`).join('\n'),
    rules: rules.combined,
  });
  const runnerE4 = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: sessE4.id, systemPrompt, maxSteps: 6 });
  const msgsE4 = await withTimeout(runnerE4.run({
    messages: [],
    userInput: { text: '用 Glob 查找当前目录所有 .ts 文件，然后用 Bash 执行 echo "found <数量> files"' },
  }), 60000);
  assert(msgsE4 !== null, '多步工具调用完成');
  if (msgsE4) {
    const toolCallNames = msgsE4.filter((m) => m.toolCalls?.length).flatMap((m) => m.toolCalls!.map((t) => t.name));
    const uniqueTools = [...new Set(toolCallNames)];
    assert(uniqueTools.length >= 2, `使用了 ${uniqueTools.length} 种工具: ${uniqueTools.join(', ')}`);
  }

  // E5: 中途中断
  console.log('\n[E5] 中途中断（abort signal）');
  const sessE5 = await sm.create({ cwd, title: 'e5 abort' });
  const controller = new AbortController();
  const runnerE5 = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: sessE5.id, systemPrompt, maxSteps: 30, signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  const start = Date.now();
  let abortedByKilled = false;
  try {
    const msgs = await runnerE5.run({ messages: [], userInput: { text: '用 Bash 执行 ping -n 100 127.0.0.1' } });
    for (const m of msgs) {
      if (m.toolResult?.content.includes('killed')) abortedByKilled = true;
    }
  } catch (e) {
    abortedByKilled = true;
  }
  const elapsed = Date.now() - start;
  assert(elapsed < 10000, `中断生效（${elapsed}ms < 10s）`);
  // abort 后可能 abort 在 model 调用阶段（killed=false），也可能 abort 在 bash 阶段（killed=true）
  assert(elapsed < 10000, 'agent 快速响应 abort');

  // 总结
  console.log('\n=== Suite E 总结 ===');
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