/**
 * 简单的烟雾测试 - 不调用模型，只测试模块导入和配置加载
 */
import { loadGlobalConfig, createBuiltinRegistry, PermissionEngine, McpManager, SessionManager, loadRules, DEFAULT_CONFIG } from '@codix/core';

async function main(): Promise<void> {
  console.log('=== Smoke Test ===');

  // 1. 默认配置
  console.log('\n[1] 默认配置:');
  console.log('  permission rules:', DEFAULT_CONFIG.permissionRules.length);

  // 2. 全局配置加载
  console.log('\n[2] 加载全局配置:');
  const cfg = await loadGlobalConfig();
  console.log('  models:', Object.keys(cfg.models));

  // 3. 工具注册表
  console.log('\n[3] 内置工具:');
  const reg = createBuiltinRegistry(cfg);
  for (const t of reg.list()) {
    console.log('  -', t.schema.name);
  }

  // 4. 权限引擎
  console.log('\n[4] 权限引擎:');
  const perm = new PermissionEngine(cfg);
  const r1 = await perm.evaluate('Bash', { command: 'ls' }, { cwd: '.', sessionId: 'test' });
  console.log('  Bash 默认:', r1.decision, '(', r1.reason, ')');
  const r2 = await perm.evaluate('Read', { filePath: 'a.txt' }, { cwd: '.', sessionId: 'test' });
  console.log('  Read 默认:', r2.decision);

  // 5. MCP Manager
  console.log('\n[5] MCP Manager:');
  const mcp = new McpManager();
  console.log('  servers:', mcp.listServers().length);

  // 6. Session Manager
  console.log('\n[6] Session Manager:');
  const sm = new SessionManager();
  const list = await sm.list();
  console.log('  sessions:', list.length);

  // 7. Rules loader
  console.log('\n[7] Rules:');
  const rules = await loadRules(process.cwd());
  console.log('  sources:', rules.sources.length);
  for (const s of rules.sources) console.log('   -', s.path);

  console.log('\n=== All OK ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});