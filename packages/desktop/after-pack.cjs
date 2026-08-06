/**
 * electron-builder afterPack 钩子
 * 把本地 workspace / file: 依赖（如 @codix/core）及其依赖
 * 从 pnpm 隔离的 node_modules 复制到打包后的 app/node_modules，
 * 让打包后的 app 能解析所有 import。
 *
 * 同时支持两种本地依赖写法：
 *   - "workspace:*"   （pnpm workspace）
 *   - "file:../core"  （npm / 纯 pnpm 兼容写法）
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const appDir = path.join(appOutDir, 'resources', 'app');
  const appNodeModules = path.join(appDir, 'node_modules');
  const root = context.packager.projectDir;

  console.log('[afterPack] app dir:', appDir);

  // 读取 desktop 的 package.json，找出本地依赖（workspace: 或 file:）
  const desktopPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const localDeps = Object.entries(desktopPkg.dependencies || {})
    .filter(([, v]) => typeof v === 'string' && (v.startsWith('workspace:') || v.startsWith('file:')))
    .map(([k]) => k);
  console.log('[afterPack] local deps:', localDeps);

  for (const depName of localDeps) {
    // 解析本地包的真实目录
    let pkgDir;
    if (depName.startsWith('@codix/')) {
      pkgDir = path.join(root, '..', depName.replace('@codix/', '')); // packages/core
    } else {
      pkgDir = path.join(root, '..', depName);
    }
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      console.log(`[afterPack] skip ${depName} (no package.json at ${pkgDir})`);
      continue;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const pkgDeps = { ...(pkg.dependencies || {}) };
    console.log(`[afterPack] ${depName} deps:`, Object.keys(pkgDeps));

    // 1) 复制本地包自身（dist + package.json + src）到 app/node_modules/<depName>
    const depTarget = path.join(appNodeModules, depName);
    copyRecursive(pkgDir, depTarget, pkgJsonPath);

    // 2) 复制本地包自己的依赖到 app/node_modules/<depName>/node_modules
    const targetNm = path.join(depTarget, 'node_modules');
    fs.mkdirSync(targetNm, { recursive: true });

    for (const [depName2, depVer] of Object.entries(pkgDeps)) {
      const src = resolveDep(root, depName2, depVer);
      if (src) {
        copyRecursive(src, path.join(targetNm, depName2), null);
      } else {
        console.log(`[afterPack]   WARN: ${depName2} not found`);
      }
    }
  }

  console.log('[afterPack] done');
};

/** 在 pnpm / 普通 node_modules 中解析某个依赖的真实路径 */
function resolveDep(root, depName2, depVer) {
  const rootNm = path.join(root, 'node_modules');
  const candidates = [
    path.join(rootNm, '.pnpm', `${depName2.replace('/', '+')}@${String(depVer).replace(/^[\^~]/, '')}`, 'node_modules', depName2),
    path.join(rootNm, depName2),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 模糊匹配 .pnpm 下的任意版本
  try {
    const pnpmDir = path.join(rootNm, '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      for (const d of fs.readdirSync(pnpmDir)) {
        if (d.startsWith(depName2.replace('/', '+') + '@')) {
          const c = path.join(pnpmDir, d, 'node_modules', depName2);
          if (fs.existsSync(c)) return c;
        }
      }
    }
  } catch (e) {}
  return null;
}

/** 递归复制；allowList 为空时复制全部，否则只复制列出的入口（用于精简包目录） */
function copyRecursive(src, dst, pkgJsonPath) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    // 包目录里跳过 node_modules（依赖会在第 2 步单独复制）
    const skip = pkgJsonPath ? new Set(['node_modules', '.git', 'test', 'dist', 'src']) : new Set();
    for (const f of fs.readdirSync(src)) {
      if (skip.has(f)) continue;
      copyRecursive(path.join(src, f), path.join(dst, f), null);
    }
    // 显式复制 dist 与 src（运行时需要）
    if (pkgJsonPath) {
      for (const need of ['dist', 'src']) {
        const s = path.join(src, need);
        if (fs.existsSync(s)) copyRecursive(s, path.join(dst, need), null);
      }
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  } else if (stat.isSymbolicLink()) {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.symlinkSync(fs.readlinkSync(src), dst);
    } catch (e) {}
  }
}
