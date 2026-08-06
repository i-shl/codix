[中文](./README.zh-CN.md) | [English](./README.md)

# @voked/desktop

voked 的桌面端：基于 **Electron + Vue 3 + Vite** 的 AI Agent 客户端。

底层复用 `@voked/core` 核心引擎，与 CLI 共享同一套工具 / 模型 / MCP / Skill 能力。

## 支持的平台

| 平台 | 安装包格式 | 打包命令 |
|---|---|---|
| Windows | NSIS `.exe`（`voked-Setup-x.y.z.exe`） | `pnpm package:desktop:win` |
| macOS | `.dmg` | `pnpm package:desktop:mac` |
| Linux | `.AppImage` / `.deb` | `pnpm package:desktop:linux` |

> 打包需要在**对应平台 + 有网络**的环境下执行（electron-builder 会下载该平台的 Electron 二进制）。
> 应用图标：`build/icon.png` 与 `build/icon.ico`，可自行替换。

## 一、从源码运行 / 开发（pnpm）

```bash
git clone https://github.com/i-shl/voked.git
cd voked
pnpm install
pnpm build:desktop        # 先构建渲染层 + 主进程
```

开发模式（热更新）：

```bash
pnpm dev:desktop
# 等价于：Vite dev server（渲染层）+ tsc watch（主进程）+ 启动 Electron
```

仅启动一次（已构建产物）：

```bash
cd packages/desktop && npx electron .
```

## 二、打包（发布到 GitHub Releases）

在**目标平台**上：

```bash
# Windows
pnpm package:desktop:win

# macOS
pnpm package:desktop:mac

# Linux
pnpm package:desktop:linux
```

产物位于 `packages/desktop/release/`（已被 `.gitignore` 忽略，不入库）。

- Windows：NSIS 安装包，支持「选择安装目录」「桌面快捷方式」。
- macOS：`dmg`，分类 `developer-tools`。
- Linux：`AppImage` 与 `deb`，分类 `Development`。

electron-builder 配置见本目录 `package.json` 的 `build` 字段；`after-pack.cjs` 负责把 pnpm 隔离的依赖复制到打包后的 app 中。

## 三、功能

- 多 Tab：对话 / 历史 / 技能 / MCP / 规则 / 设置
- 模型配置、MCP 服务器管理
- 粘贴图片、附件（支持任意文件类型）
- 项目切换
- 全自动模式：工具调用直接执行，无需逐次确认
- 界面语言（英 / 中，默认中文）：打开「设置 → 语言」，点「中文 / English」即时切换；选择同时写入 `localStorage` 与全局配置 `ui.language`，CLI 也会沿用。

## 四、测试

```bash
pnpm --filter @voked/desktop test   # 消息队列单元测试
pnpm --filter @voked/desktop typecheck
```

## 说明

桌面端与 CLI 的模型 / MCP / Skill 配置共用 `~/.voked/config.json`（首次用 CLI 的 `--config` 初始化即可，桌面端也能读取）。

## 关于本项目

voked 由 **CodeBuddy 的 hy3 模型**从 0 到 1 全程辅助开发完成。
