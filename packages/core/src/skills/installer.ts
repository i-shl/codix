/**
 * Skill 安装器
 *
 * 支持的来源：
 *  - local:<dir>                      从本地目录复制
 *  - npm:<pkg>                        从 npm registry 安装（执行 npm pack 然后解压）
 *  - git:<repo>                       从 git 仓库克隆（需要在 PATH 中有 git）
 *  - tarball:<url>                    从 URL 下载 tarball
 *  - https://www.skills.sh/o/r/skill  skills.sh 生态（映射到 GitHub 仓库子目录）
 *  - https://github.com/o/r[/tree/branch/path]  GitHub 仓库（或其中某个 skill 子目录）
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { ToolRegistry } from '../tools/registry.js';
import type { SkillManager } from './manager.js';
import { parseFrontmatter } from './manager.js';
import { ensureDir, fileExists, isPathInside, readFileText, writeFileAtomic, CODIX_HOME } from '../utils/fs.js';
import { SkillError } from '../errors.js';
import { getLogger } from '../logger.js';
import { DEFAULT_SKILLS } from './defaults.js';

const log = getLogger('skill-installer');

export type SkillInstallScope = 'global' | 'project';

export class SkillInstaller {
  constructor(private manager: SkillManager, private registry: ToolRegistry) {}

  async install(source: string, opts: { scope?: SkillInstallScope; cwd?: string } = {}): Promise<string> {
    const scope = opts.scope ?? 'global';
    const cwd = opts.cwd ?? process.cwd();
    const installRoot = scope === 'global' ? path.join(CODIX_HOME, 'skills') : path.join(cwd, '.codix', 'skills');
    await ensureDir(installRoot);

    let sourcePath: string;
    let skillName: string;
    if (source.startsWith('local:')) {
      sourcePath = source.slice('local:'.length);
      skillName = path.basename(sourcePath);
    } else if (source.startsWith('npm:')) {
      const pkg = source.slice('npm:'.length);
      const tmp = path.join(CODIX_HOME, '.cache', 'npm-' + Date.now());
      await ensureDir(tmp);
      await runCmd('npm', ['pack', pkg], tmp);
      const tarball = (await fs.readdir(tmp)).find((f) => f.endsWith('.tgz'));
      if (!tarball) throw new SkillError('npm pack 失败：未找到 tarball');
      const skillDir = path.join(tmp, 'extracted');
      await ensureDir(skillDir);
      await runCmd('tar', ['-xzf', path.join(tmp, tarball), '-C', skillDir], tmp);
      sourcePath = path.join(skillDir, 'package');
      skillName = await inferName(sourcePath, pkg);
    } else if (source.startsWith('git:')) {
      const repo = source.slice('git:'.length);
      const tmp = path.join(CODIX_HOME, '.cache', 'git-' + Date.now());
      await ensureDir(tmp);
      await runCmd('git', ['clone', '--depth=1', repo, tmp], tmp);
      sourcePath = tmp;
      skillName = await inferName(sourcePath, path.basename(repo, '.git'));
    } else if (isRepoSkillUrl(source)) {
      const resolved = await downloadRepoSkill(source);
      sourcePath = resolved.dir;
      skillName = await inferName(sourcePath, resolved.fallbackName);
    } else if (source.startsWith('tarball:') || source.startsWith('http://') || source.startsWith('https://')) {
      const url = source.startsWith('tarball:') ? source.slice('tarball:'.length) : source;
      // 下载大小上限 50MB，防止恶意 URL 触发 OOM
      const MAX_DOWNLOAD = 50 * 1024 * 1024;
      const tmp = path.join(CODIX_HOME, '.cache', 'dl-' + Date.now() + '.tgz');
      await ensureDir(path.dirname(tmp));
      const res = await fetch(url);
      if (!res.ok) throw new SkillError(`下载失败 HTTP ${res.status}`);
      const cl = Number(res.headers.get('content-length') ?? 0);
      if (cl > MAX_DOWNLOAD) throw new SkillError(`下载内容 ${cl} 字节超过 ${MAX_DOWNLOAD} 限制`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_DOWNLOAD) throw new SkillError(`下载内容超过 ${MAX_DOWNLOAD} 限制`);
      await fs.writeFile(tmp, buf);
      const skillDir = path.join(CODIX_HOME, '.cache', 'extract-' + Date.now());
      await ensureDir(skillDir);
      // 显式指定 --no-absolute-names / -P 默认是禁用的，但为防 -C 解析不到时穿越父目录，再用 strip-components 限制
      await runCmd('tar', ['-xzf', tmp, '-C', skillDir, '--strip-components=0'], path.dirname(tmp));
      sourcePath = skillDir;
      skillName = await inferName(sourcePath, 'skill');
    } else {
      throw new SkillError(`未知来源: ${source}`);
    }

    const dest = path.join(installRoot, skillName);
    const existed = await fileExists(path.join(dest, 'manifest.json'));
    if (existed) {
      // 已存在同名校验：是否覆盖由调用方决定；这里只警告
      log.warn(`覆盖已安装 skill: ${dest}`);
    }
    await fs.rm(dest, { recursive: true, force: true });
    try {
      await copyDir(sourcePath, dest);
    } catch (e) {
      // 安装失败时回滚
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    try {
      const loaded = await this.manager.loadAndRegister(dest);
      if (!loaded) {
        throw new SkillError(`不是有效的 skill：${dest} 缺少 manifest.json 或 SKILL.md`);
      }
    } catch (e) {
      // 加载/注册失败时回滚
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    return dest;
  }

  async uninstall(name: string, opts: { scope?: SkillInstallScope; cwd?: string } = {}): Promise<void> {
    const scope = opts.scope ?? 'global';
    const cwd = opts.cwd ?? process.cwd();
    const installRoot = scope === 'global' ? path.join(CODIX_HOME, 'skills') : path.join(cwd, '.codix', 'skills');
    const target = path.join(installRoot, name);
    await fs.rm(target, { recursive: true, force: true });
  }
}

/**
 * 首次运行时自动安装默认推荐 skill（如 find-skills）。
 * 已存在则跳过；失败仅告警（不阻断启动）。全局安装到 ~/.codix/skills。
 */
export async function ensureDefaultSkills(installer: SkillInstaller): Promise<void> {
  const globalRoot = path.join(CODIX_HOME, 'skills');
  for (const s of DEFAULT_SKILLS) {
    const dest = path.join(globalRoot, s.name);
    if (
      (await fileExists(path.join(dest, 'manifest.json'))) ||
      (await fileExists(path.join(dest, 'SKILL.md')))
    ) {
      continue;
    }
    try {
      await installer.install(s.source, { scope: 'global' });
      log.info(`已自动安装默认 skill: ${s.name}`);
    } catch (e) {
      log.warn(`默认 skill 自动安装失败: ${s.name} - ${(e as Error).message}`);
    }
  }
}

async function inferName(skillPath: string, fallback: string): Promise<string> {
  const manifest = path.join(skillPath, 'manifest.json');
  if (await fileExists(manifest)) {
    try {
      const m = JSON.parse(await readFileText(manifest));
      if (m.name) return sanitizeName(String(m.name), fallback);
    } catch {}
  }
  const skillMd = path.join(skillPath, 'SKILL.md');
  if (await fileExists(skillMd)) {
    try {
      const { meta } = parseFrontmatter(await readFileText(skillMd));
      if (meta.name) return sanitizeName(meta.name, fallback);
    } catch {}
  }
  return sanitizeName(fallback, 'skill');
}

/** 目录名安全化：只允许 [A-Za-z0-9._-]，防止 manifest 里塞 ../ 造成越界写 */
function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '');
  return cleaned || fallback;
}

// ============ GitHub / skills.sh 仓库形态的 skill ============

export function isRepoSkillUrl(source: string): boolean {
  if (!/^https?:\/\//i.test(source)) return false;
  let u: URL;
  try {
    u = new URL(source);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return host === 'skills.sh' || host === 'www.skills.sh' || host === 'github.com' || host === 'www.github.com';
}

interface RepoRef {
  owner: string;
  repo: string;
  /** 仓库内的 skill 子目录，空表示仓库根 */
  subPath: string;
  branch?: string;
}

export function parseRepoSkillUrl(source: string): RepoRef {
  const u = new URL(source);
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (host.endsWith('skills.sh')) {
    // https://www.skills.sh/<owner>/<repo>/<skill>
    if (segs.length < 2) throw new SkillError(`无法解析 skills.sh 地址: ${source}`);
    return { owner: segs[0], repo: segs[1], subPath: segs.slice(2).join('/') };
  }

  // github.com/<owner>/<repo>[/tree/<branch>/<path...>]
  if (segs.length < 2) throw new SkillError(`无法解析 GitHub 地址: ${source}`);
  const owner = segs[0];
  const repo = segs[1].replace(/\.git$/, '');
  if (segs[2] === 'tree' && segs.length >= 4) {
    return { owner, repo, branch: segs[3], subPath: segs.slice(4).join('/') };
  }
  // 支持 ?skill=xxx（skills CLI 的 --skill 风格）
  const skillParam = new URL(source).searchParams.get('skill');
  return { owner, repo, subPath: skillParam ?? '' };
}

async function downloadRepoSkill(source: string): Promise<{ dir: string; fallbackName: string }> {
  const ref = parseRepoSkillUrl(source);
  const branches = ref.branch ? [ref.branch] : ['main', 'master'];
  const workRoot = path.join(CODIX_HOME, '.cache', 'repo-' + Date.now());
  await ensureDir(workRoot);

  let lastErr: Error | null = null;
  for (const branch of branches) {
    const url = `https://codeload.github.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/tar.gz/refs/heads/${encodeURIComponent(branch)}`;
    try {
      const tgz = path.join(workRoot, `${branch}.tgz`);
      await downloadTo(url, tgz);
      const extractDir = path.join(workRoot, branch);
      await ensureDir(extractDir);
      // GitHub tarball 顶层是 <repo>-<branch>/，strip 掉
      await runCmd('tar', ['-xzf', tgz, '-C', extractDir, '--strip-components=1'], workRoot);
      const target = ref.subPath ? path.join(extractDir, ref.subPath) : extractDir;
      const abs = path.resolve(target);
      if (!isPathInside(abs, path.resolve(extractDir)) && abs !== path.resolve(extractDir)) {
        throw new SkillError(`skill 子路径越界: ${ref.subPath}`);
      }
      if (!(await fileExists(abs))) {
        throw new SkillError(`仓库中不存在该 skill 目录: ${ref.subPath || '(根目录)'}`);
      }
      const dir = (await findSkillRoot(abs)) ?? abs;
      return { dir, fallbackName: ref.subPath ? path.basename(ref.subPath) : ref.repo };
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new SkillError(`下载 skill 失败 (${ref.owner}/${ref.repo}): ${lastErr?.message ?? '未知错误'}`, undefined, lastErr);
}

/** 如果 dir 本身没有 manifest.json / SKILL.md，往下找一层（常见于 repo 根 → skills/<name>/） */
async function findSkillRoot(dir: string): Promise<string | null> {
  if ((await fileExists(path.join(dir, 'manifest.json'))) || (await fileExists(path.join(dir, 'SKILL.md')))) {
    return dir;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const child = path.join(dir, e.name);
    if ((await fileExists(path.join(child, 'manifest.json'))) || (await fileExists(path.join(child, 'SKILL.md')))) {
      return child;
    }
  }
  return null;
}

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new SkillError(`下载失败 HTTP ${res.status} (${url})`);
  const cl = Number(res.headers.get('content-length') ?? 0);
  if (cl > MAX_DOWNLOAD_BYTES) throw new SkillError(`下载内容 ${cl} 字节超过 ${MAX_DOWNLOAD_BYTES} 限制`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) throw new SkillError(`下载内容超过 ${MAX_DOWNLOAD_BYTES} 限制`);
  await ensureDir(path.dirname(dest));
  await fs.writeFile(dest, buf);
}

async function copyDir(src: string, dest: string): Promise<void> {
  // 防 tar 路径穿越：拒绝把文件复制到 dest 之外
  const destAbs = path.resolve(dest);
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.resolve(src, e.name);
    const d = path.resolve(dest, e.name);
    // d 必须在 destAbs 之下（防 ../ 越界）
    if (!isPathInside(d, destAbs)) {
      throw new SkillError(`拒绝复制越界文件: ${d} (源 ${s})`);
    }
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true, stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`));
    });
  });
}