/**
 * 集成测试 - 模型 + Skill + MCP（精简版，单步验证）
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
  McpManager,
  registerMcpTools,
  SkillManager,
  SkillInstaller,
} from '@codix/core';

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms)),
  ]);
}

async function main(): Promise<void> {
  console.log('=== 集成测试 ===\n');

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codix-int-'));
  console.log('[setup] cwd:', cwd);

  // 1. Skill 准备
  const skillDir = path.join(cwd, '_skill-src', 'greet');
  await fs.mkdir(path.join(skillDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(skillDir, 'manifest.json'), JSON.stringify({
    name: 'greet',
    version: '1.0.0',
    description: 'Greeting skill',
    prompt: '你可以用 greet 工具向某人打招呼',
    tools: [{
      name: 'greet',
      description: '向指定名字打招呼',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      entry: './tools/greet.js',
    }],
  }, null, 2));
  await fs.writeFile(path.join(skillDir, 'tools', 'greet.js'), `
export default {
  async execute(input) {
    return { toolCallId: '', content: '你好，' + (input.name ?? '世界') + '！来自 greet skill。' };
  },
  renderUse(input) { return 'greet ' + (input.name ?? ''); },
};
`);

  // 2. 写项目配置
  const cfg = await loadMergedConfig(cwd);
  const projectCfg = {
    models: cfg.models,
    defaultModel: cfg.defaultModel,
    permissionRules: [],
    mcpServers: [
      {
        name: 'mock',
        transport: 'stdio',
        command: 'node',
        args: [path.resolve('test/mock-mcp-server.mjs')],
        autoConnect: true,
      },
    ],
  };
  await fs.mkdir(path.join(cwd, '.codix'), { recursive: true });
  await fs.writeFile(path.join(cwd, '.codix', 'config.json'), JSON.stringify(projectCfg, null, 2));
  const mergedCfg = await loadMergedConfig(cwd);

  // 3. 模型
  const key = mergedCfg.defaultModel!;
  const modelCfg = mergedCfg.models[key];
  const model = createAdapter({ ...modelCfg, provider: modelCfg.provider ?? inferProvider(modelCfg.model) });

  // 4. 注册表 + MCP
  const registry = createBuiltinRegistry(mergedCfg);
  const mcp = new McpManager();
  await withTimeout(mcp.connect(mergedCfg.mcpServers[0]), 10000, 'MCP 连接');
  registerMcpTools(registry, mcp, 'mock');
  await new Promise((r) => setTimeout(r, 300));

  // 5. Skill
  const skills = new SkillManager(registry);
  const installer = new SkillInstaller(skills, registry);
  await installer.install('local:' + skillDir, { scope: 'project', cwd });

  const tools = registry.list();
  console.log('[tools] 总数:', tools.length, '| MCP:', tools.filter((t) => t.source.type === 'mcp').map((t) => t.schema.name), '| Skill:', tools.filter((t) => t.source.type === 'skill').map((t) => t.schema.name));

  // 6. session + system
  const perm = new PermissionEngine(mergedCfg);
  const sm = new SessionManager({ baseDir: path.join(cwd, '.codix', 'sessions') });
  const rules = await loadRules(cwd);
  const skillPrompts = await skills.collectPrompts(cwd);
  const systemPrompt = buildSystemPrompt({
    identity: 'You are codix. Be concise.',
    tools: tools.map((t) => `- ${t.schema.name}: ${t.schema.description}`).join('\n'),
    rules: rules.combined,
    skills: skillPrompts,
  });

  // 7. 测试：模型调用 MCP 工具
  console.log('\n[1] MCP 工具调用');
  let sess = await sm.create({ cwd, title: 'mcp' });
  let runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: sess.id, systemPrompt, maxSteps: 4 });
  let msgs = await withTimeout(runner.run({ messages: [], userInput: { text: '调用 echo 工具，传入 text="integration test"' } }), 60000, 'MCP run');
  for (const m of msgs) {
    if (m.toolCalls?.length) console.log('  →', m.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(', '));
    if (m.toolResult) console.log('  ←', m.toolResult.content.slice(0, 150).replace(/\n/g, ' '));
    if (typeof m.content === 'string' && m.content && !m.toolCalls) console.log('  💬', m.content.slice(0, 150));
  }

  // 8. 测试：模型调用 Skill 工具
  console.log('\n[2] Skill 工具调用');
  sess = await sm.create({ cwd, title: 'skill' });
  runner = new AgentRunner({ model, tools, permission: perm, cwd, sessionId: sess.id, systemPrompt, maxSteps: 4 });
  msgs = await withTimeout(runner.run({ messages: [], userInput: { text: '用 greet 工具向 "小明" 打招呼' } }), 60000, 'Skill run');
  for (const m of msgs) {
    if (m.toolCalls?.length) console.log('  →', m.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(', '));
    if (m.toolResult) console.log('  ←', m.toolResult.content.slice(0, 150).replace(/\n/g, ' '));
    if (typeof m.content === 'string' && m.content && !m.toolCalls) console.log('  💬', m.content.slice(0, 150));
  }

  await mcp.disconnect('mock');
  console.log('\n=== 集成测试完成 ===');
}

main().catch((e) => {
  console.error('错误:', e);
  process.exit(1);
});