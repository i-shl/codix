/**
 * Skill 系统
 *
 * Skill 是一个带 manifest 的目录或 npm 包，包含：
 *  - prompt.md            注入到系统提示
 *  - tools/*.js           注册的工具
 *  - assets/              静态资源
 *
 * 安装路径：
 *  - 全局：~/.codix/skills/<name>/
 *  - 项目：<project>/.codix/skills/<name>/
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { ToolRegistry } from '../tools/registry.js';
import type { Skill, SkillManifest, SkillToolDef } from '../types/skill.js';
import { SkillError } from '../errors.js';
import { CODIX_HOME, ensureDir, fileExists, isPathInside, readFileText } from '../utils/fs.js';

/**
 * 技能发现目录（遵循 Agent Skills 生态约定，兼容 Claude Code / Codex）：
 *   - 项目级：<cwd>/.codix/skills（我们的项目安装位）、skills、.agents/skills、.claude/skills、.codex/skills
 *   - 用户级：~/.codix/skills（我们的全局安装位）、.agents/skills、.claude/skills、.codex/skills
 *
 * 路径全部由 os.homedir() / cwd 推导，绝不写死绝对路径（如 C:\Users\xxx\.agents\skills）。
 */
export function skillSearchRoots(cwd: string): string[] {
  const home = os.homedir();
  const roots: string[] = [
    path.join(cwd, '.codix', 'skills'),
    path.join(cwd, 'skills'),
    path.join(cwd, '.agents', 'skills'),
    path.join(cwd, '.claude', 'skills'),
    path.join(cwd, '.codex', 'skills'),
  ];
  if (home) {
    roots.push(
      path.join(home, '.codix', 'skills'),
      path.join(home, '.agents', 'skills'),
      path.join(home, '.claude', 'skills'),
      path.join(home, '.codex', 'skills'),
    );
  }
  // 去重并规范化
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of roots) {
    const norm = path.resolve(r);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export class SkillManager {
  constructor(private registry: ToolRegistry) {}

  /** 列出所有已安装的 skill（项目级 + 用户级多目录发现） */
  async listSkills(cwd: string): Promise<Skill[]> {
    const roots = skillSearchRoots(cwd);
    const out: Skill[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      if (!(await fileExists(root))) continue;
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const skillPath = path.join(root, e.name);
        const key = path.resolve(skillPath);
        if (seen.has(key)) continue;
        seen.add(key);
        const skill = await loadSkill(skillPath);
        if (skill) out.push(skill);
      }
    }
    return out;
  }

  /** 加载单个 skill 并注册其工具 */
  async loadAndRegister(skillPath: string): Promise<Skill | null> {
    const skill = await loadSkill(skillPath);
    if (!skill) return null;
    await this.registerTools(skill);
    return skill;
  }

  async registerTools(skill: Skill): Promise<void> {
    const manifest = skill.manifest;
    for (const t of manifest.tools ?? []) {
      const toolName = `${manifest.name}__${t.name}`;
      // 幂等：同一 skill 只注册一次（如 ensureDefaultSkills 已装并注册，再跑 createAgentContext 时跳过）
      if (this.registry.get(toolName)) continue;
      const entryPath = path.resolve(skill.path, t.entry);
      // 防止恶意 manifest 把 entry 指向 skill 目录外（如 ../../../tmp/evil.js）
      if (!isPathInside(entryPath, skill.path)) {
        throw new SkillError(`Skill ${manifest.name}: 工具 ${t.name} 的 entry 越界 ${t.entry}`, manifest.name);
      }
      const mod = await import(pathToFileUrl(entryPath).href).catch((e) => {
        throw new SkillError(`Skill ${manifest.name}: 加载 ${t.entry} 失败: ${(e as Error).message}`, manifest.name, e);
      });
      const def = mod.default ?? mod;
      if (!def || typeof def.execute !== 'function') {
        throw new SkillError(`Skill ${manifest.name}: 工具 ${t.name} 未导出 default.execute`, manifest.name);
      }
      this.registry.register({
        schema: { name: toolName, description: `[Skill ${manifest.name}] ${t.description}`, inputSchema: t.inputSchema },
        source: { type: 'skill', skillName: manifest.name },
        execute: def.execute,
        renderUse: def.renderUse,
        renderResult: def.renderResult,
      });
    }
  }

  /** 收集所有 skill 的 prompt 片段 */
  async collectPrompts(cwd: string): Promise<string> {
    const skills = await this.listSkills(cwd);
    const parts: string[] = [];
    for (const s of skills) {
      if (!s.enabled) continue;
      if (s.manifest.prompt) parts.push(`## ${s.manifest.name}\n${s.manifest.prompt}`);
    }
    return parts.join('\n\n');
  }
}

export async function loadSkill(skillPath: string): Promise<Skill | null> {
  const manifestPath = path.join(skillPath, 'manifest.json');
  if (await fileExists(manifestPath)) {
    try {
      const text = await readFileText(manifestPath);
      const manifest = JSON.parse(text) as SkillManifest;
      if (!manifest.name || !manifest.version) {
        throw new SkillError(`manifest 缺少 name/version：${skillPath}`);
      }
      return { manifest, path: skillPath, enabled: true };
    } catch (e) {
      if (e instanceof SkillError) throw e;
      throw new SkillError(`解析 manifest 失败: ${skillPath}: ${(e as Error).message}`, undefined, e);
    }
  }

  // 兼容 Agent Skills 生态（skills.sh / Anthropic）的 SKILL.md 格式
  const skillMd = path.join(skillPath, 'SKILL.md');
  if (await fileExists(skillMd)) {
    const text = await readFileText(skillMd);
    const { meta, body } = parseFrontmatter(text);
    const name = meta.name || path.basename(skillPath);
    return {
      manifest: {
        name,
        version: meta.version || '0.0.0',
        description: meta.description || '',
        prompt: body.trim(),
      },
      path: skillPath,
      enabled: true,
    };
  }

  return null;
}

/** 极简 YAML frontmatter 解析：只取顶层 `key: value`，够用于 SKILL.md */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return { meta: {}, body: normalized };
  const end = normalized.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: normalized };
  const head = normalized.slice(3, end);
  const body = normalized.slice(end + 4).replace(/^[^\n]*\n?/, '');
  const meta: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[m[1]] = v;
  }
  return { meta, body };
}

function pathToFileUrl(p: string): URL {
  const normalized = (p.startsWith('/') ? p : '/' + p).replace(/\\/g, '/');
  return new URL('file://' + normalized);
}