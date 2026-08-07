/**
 * electron-builder afterPack 钩子
 *
 * 把 workspace 本地依赖（@voked/core）及其【完整且版本正确】的依赖闭包，
 * 从 pnpm 的隔离 node_modules（软链 + .pnpm 虚拟仓库）解引用复制进
 *   app/node_modules/@voked/core/node_modules
 * 让打包后的 app 能解析所有 import（含任意深度的间接依赖，例如
 * @modelcontextprotocol/sdk → cross-spawn → which → isexe，以及存在多版本
 * 并存的情况，如 ajv-formats → ajv@^8）。
 *
 * 关键设计：
 *   - 不自己重建依赖树，而是【跟随 pnpm 已经解析好的软链图】。
 *   - 每条软链的 realpath 指向 pnpm 选定的【正确版本】；传递依赖藏在
 *     各依赖 scope 目录（.pnpm/<dep>@<ver>/node_modules）里的兄弟软链中。
 *   - 对每条软链解引用（复制真实内容），并递归进入其 scope 的兄弟依赖软链，
 *     保持 pnpm 的【嵌套结构】——这样多版本并存时不会冲突。
 *   - 同一包可能在多个层级被需要（如既是 SDK 顶层依赖、又是某包的传递依赖），
 *     因此【每个需要的层级都真实复制一份】（不使用全局去重跳过），仅用
 *     递归栈集合防止真正的循环依赖造成死循环。重复副本可接受（pnpm 依赖图无环）。
 *   注意：不使用符号链接，因为构建机上的绝对路径在装到用户机器后会失效。
 *
 * 桌面端 package.json 已设置 "asar": false，所有文件以真实文件系统存在，
 * Electron 的 ESM 解析与未打包时一致（asar 虚拟文件系统对 ESM 的
 * node_modules 向上查找支持不全，禁用 asar 最稳）。
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const appDir = path.join(appOutDir, 'resources', 'app');
  const appNodeModules = path.join(appDir, 'node_modules');
  const root = context.packager.projectDir;

  console.log('[afterPack] app dir:', appDir);

  const desktopPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const localDeps = Object.entries(desktopPkg.dependencies || {})
    .filter(([, v]) => typeof v === 'string' && (v.startsWith('workspace:') || v.startsWith('file:')))
    .map(([k]) => k);
  console.log('[afterPack] local deps:', localDeps);

  // 递归栈：仅用于防止循环依赖造成死循环（不用于去重，避免漏复制）
  const visiting = new Set();

  for (const depName of localDeps) {
    // 本地 workspace 包的真实源码目录（packages/core）
    const pkgDir = depName.startsWith('@voked/')
      ? path.join(root, '..', depName.replace('@voked/', ''))
      : path.join(root, '..', depName);
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      console.log(`[afterPack] skip ${depName} (no package.json at ${pkgDir})`);
      continue;
    }

    // 1) 复制本地包自身（dist + src + package.json）到 app/node_modules/<depName>
    const depTarget = path.join(appNodeModules, depName);
    copyRecursive(pkgDir, depTarget, pkgJsonPath, new Set());

    // 2) 复制其 node_modules 里的依赖（pnpm 解析好的软链 → 解引用复制）
    const depNodeModules = path.join(pkgDir, 'node_modules');
    const targetNm = path.join(depTarget, 'node_modules');
    console.log(`[afterPack] collecting deps for ${depName} from`, depNodeModules);
    collectFromNodeModules(depNodeModules, targetNm, visiting);

    console.log(`[afterPack] ${depName}: done`);
  }

  console.log('[afterPack] done');
};

/** 从某个 node_modules 目录出发，跟随软链复制其中的依赖（含 scoped 子目录） */
function collectFromNodeModules(dir, targetDir, visiting) {
  if (!fs.existsSync(dir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    if (['.pnpm', '.bin', '.cache', '.modules.yaml'].includes(entry)) continue;
    const src = path.join(dir, entry);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch (e) {
      continue;
    }
    if (st.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(src);
      } catch (e) {
        continue;
      }
      if (!real.includes('.pnpm')) continue; // 只复制来自 pnpm 仓库的依赖
      copyPkgAndDeps(real, path.join(targetDir, entry), visiting);
    } else if (st.isDirectory()) {
      // scoped 容器目录（如 @modelcontextprotocol），递归进入
      collectFromNodeModules(src, path.join(targetDir, entry), visiting);
    }
  }
}

/** 从依赖真实路径向上找到其 pnpm scope 的 node_modules 目录
 * pnpm 布局：.pnpm/<pkg>@<ver>/node_modules/<dep>
 * 该 scope 的 node_modules 是「祖父目录为 .pnpm 的那个 node_modules」 */
function findScopeNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (true) {
    const parent = path.dirname(dir);
    const grandparent = path.dirname(parent);
    if (path.basename(dir) === 'node_modules' && path.basename(grandparent) === '.pnpm') {
      return dir;
    }
    if (dir === parent) break;
    dir = parent;
  }
  return path.dirname(realPkgPath);
}

/** 复制一个真实依赖包，并递归复制其 scope 内的兄弟依赖（传递依赖） */
function copyPkgAndDeps(realPkgPath, targetDir, visiting) {
  // 自引用（scope 内包含依赖自身）直接跳过，避免无限递归
  if (visiting.has(realPkgPath.toLowerCase())) return;
  visiting.add(realPkgPath.toLowerCase());

  copyRecursive(realPkgPath, targetDir, null, new Set());

  // 该依赖的 scope node_modules：.pnpm/<dep>@<ver>/node_modules
  // 注意作用域包（如 @modelcontextprotocol/sdk）真实路径为
  //   .pnpm/.../node_modules/@modelcontextprotocol/sdk
  // 其 scope 是「祖父目录为 .pnpm 的那个 node_modules」。
  const scopeNm = findScopeNodeModules(realPkgPath);
  collectFromScope(scopeNm, path.join(targetDir, 'node_modules'), visiting, realPkgPath);

  visiting.delete(realPkgPath.toLowerCase());
}

/** 进入某一依赖的 scope node_modules，复制其直接依赖（兄弟软链），递归 */
function collectFromScope(scopeNm, targetNm, visiting, selfReal) {
  if (!fs.existsSync(scopeNm)) return;
  fs.mkdirSync(targetNm, { recursive: true });
  let entries;
  try {
    entries = fs.readdirSync(scopeNm);
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    if (['.pnpm', '.bin', '.cache', '.modules.yaml'].includes(entry)) continue;
    const src = path.join(scopeNm, entry);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch (e) {
      continue;
    }
    if (st.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(src);
      } catch (e) {
        continue;
      }
      if (!real.includes('.pnpm')) continue;
      // 跳过依赖自身（scope 内包含依赖自己的条目），Windows 路径大小写不一致
      if (real.toLowerCase() === selfReal.toLowerCase()) continue;
      copyPkgAndDeps(real, path.join(targetNm, entry), visiting);
    } else if (st.isDirectory()) {
      // scoped 容器目录，递归
      collectFromScope(src, path.join(targetNm, entry), visiting, selfReal);
    }
  }
}

/**
 * 递归复制；对软链做「解引用」——复制真实内容而不是重建软链（asar 内软链会失效）。
 * visited 记录已复制的真实路径，避免 pnpm 软链回指造成的死循环。
 * pkgJsonPath 非空时表示正在复制一个 npm 包目录：跳过其 node_modules
 * （依赖由递归调用以嵌套方式单独复制），并显式复制 dist / src。
 */
function copyRecursive(src, dst, pkgJsonPath, visited) {
  if (!fs.existsSync(src)) return;
  let stat;
  try {
    stat = fs.lstatSync(src);
  } catch (e) {
    return;
  }

  if (stat.isSymbolicLink()) {
    let real;
    try {
      real = fs.realpathSync(src);
    } catch (e) {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    copyRecursive(real, dst, null, visited);
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    const skip = pkgJsonPath ? new Set(['node_modules', '.git', 'test', 'dist', 'src']) : new Set();
    let entries;
    try {
      entries = fs.readdirSync(src);
    } catch (e) {
      return;
    }
    for (const f of entries) {
      if (skip.has(f)) continue;
      copyRecursive(path.join(src, f), path.join(dst, f), null, visited);
    }
    if (pkgJsonPath) {
      for (const need of ['dist', 'src']) {
        const s = path.join(src, need);
        if (fs.existsSync(s)) copyRecursive(s, path.join(dst, need), null, visited);
      }
    }
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
