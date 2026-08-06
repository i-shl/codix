/**
 * MCP Manager 测试
 *
 * 测试：
 *  1. 连接 stdio MCP server
 *  2. 列出工具
 *  3. 调用工具
 *  4. 断开连接
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { McpManager, registerMcpTools, ToolRegistry } from '@codix/core';

async function main(): Promise<void> {
  console.log('=== MCP Manager 测试 ===\n');

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codix-mcp-'));
  console.log('[setup] cwd:', cwd);

  const serverScript = path.resolve('test/mock-mcp-server.mjs');

  const mgr = new McpManager();
  console.log('[connect] 启动 mock MCP server...');
  const status = await mgr.connect({
    name: 'test',
    transport: 'stdio',
    command: 'node',
    args: [serverScript],
  });
  console.log('[connect] status:', status);
  if (!status.connected) {
    console.log('  ✗ 连接失败:', status.error);
    process.exit(1);
  }

  console.log('\n[list servers]');
  const servers = mgr.listServers();
  for (const s of servers) {
    console.log(`  ${s.connected ? '✓' : '✗'} ${s.name} (${s.tools.length} tools, ${s.resources.length} resources, ${s.prompts.length} prompts)`);
  }

  console.log('\n[list tools]');
  const tools = await mgr.listToolsDetailed('test');
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description}`);
  }

  console.log('\n[call tool]');
  const result = await mgr.callTool('test', 'echo', { text: 'hello from MCP' });
  console.log('  结果:', JSON.stringify(result, null, 2));

  console.log('\n[register to ToolRegistry]');
  const reg = new ToolRegistry();
  registerMcpTools(reg, mgr, 'test');
  await new Promise((r) => setTimeout(r, 500));
  const all = reg.list();
  console.log('  注册的工具:', all.map((t) => t.schema.name).join(', '));

  const echoTool = reg.get('echo');
  if (echoTool) {
    const ctx = { cwd, sessionId: 'test', signal: undefined };
    const r = await echoTool.execute({ text: 'direct call' }, ctx);
    console.log('  直接调用:', r.content);
  }

  console.log('\n[disconnect]');
  await mgr.disconnect('test');
  const serversAfter = mgr.listServers();
  console.log('  连接状态:', serversAfter[0]?.connected ? '仍连接' : '已断开');

  console.log('\n=== MCP 测试通过 ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});