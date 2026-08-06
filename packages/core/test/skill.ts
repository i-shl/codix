/**
 * Skill 系统测试
 *
 * 测试：
 *  1. 从本地目录安装 skill
 *  2. 加载 skill 并注册其工具
 *  3. 在 agent 中使用 skill 注册的工具
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { ToolRegistry, SkillManager, SkillInstaller } from '@codix/core';

async function main(): Promise<void> {
  console.log('=== Skill 系统测试 ===\n');

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'codix-skill-'));
  console.log('[setup] cwd:', cwd);

  // 1. 创建一个测试 skill
  const skillSrc = path.join(cwd, '_src-skill', 'my-helper');
  await fs.mkdir(path.join(skillSrc, 'tools'), { recursive: true });

  await fs.writeFile(path.join(skillSrc, 'manifest.json'), JSON.stringify({
    name: 'my-helper',
    version: '0.1.0',
    description: 'A test skill that adds a counter tool',
    prompt: 'You have access to a counter tool that can increment/decrement a value.',
    tools: [{
      name: 'counter',
      description: 'Increment or decrement a counter. Returns the new value.',
      inputSchema: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['inc', 'dec'], description: 'Operation' },
          value: { type: 'integer', default: 1 },
        },
        required: ['op'],
      },
      entry: './tools/counter.js',
    }],
  }, null, 2));

  await fs.writeFile(path.join(skillSrc, 'tools', 'counter.js'), `
let counter = 0;
export default {
  async execute(input) {
    if (input.op === 'inc') counter += (input.value ?? 1);
    else counter -= (input.value ?? 1);
    return { toolCallId: '', content: 'counter = ' + counter };
  },
  renderUse(input) {
    return 'counter ' + input.op + ' ' + (input.value ?? 1);
  },
};
`);

  console.log('[setup] skill 源已创建:', skillSrc);

  // 2. 安装 skill 到项目目录
  const registry = new ToolRegistry();
  const sm = new SkillManager(registry);
  const installer = new SkillInstaller(sm, registry);

  const dest = await installer.install('local:' + skillSrc, { scope: 'project', cwd });
  console.log('[install] skill 已安装到:', dest);

  // 验证文件
  const installed = await fs.readdir(dest);
  console.log('[verify] 安装内容:', installed);

  // 3. 列出 skills
  const skills = await sm.listSkills(cwd);
  console.log('[list] 已安装:', skills.map((s) => `${s.manifest.name}@${s.manifest.version}`));

  // 4. 收集 prompts
  const prompts = await sm.collectPrompts(cwd);
  console.log('[prompts]:', prompts.slice(0, 100));

  // 5. 工具已在 install 时自动注册
  await sm.listSkills(cwd);

  // 6. 测试工具
  const allTools = registry.list();
  const counterTool = allTools.find((t) => t.schema.name === 'my-helper__counter');
  if (!counterTool) {
    console.log('  ✗ counter tool 未注册');
    process.exit(1);
  }
  console.log('[tool] 已注册:', counterTool.schema.name);

  // 执行工具
  const ctx = { cwd, sessionId: 'test', signal: undefined };
  const r1 = await counterTool.execute({ op: 'inc', value: 5 }, ctx);
  console.log('[execute inc 5]:', r1.content);
  const r2 = await counterTool.execute({ op: 'dec', value: 2 }, ctx);
  console.log('[execute dec 2]:', r2.content);
  const r3 = await counterTool.execute({ op: 'inc', value: 10 }, ctx);
  console.log('[execute inc 10]:', r3.content);

  console.log('\n=== Skill 测试通过 ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});