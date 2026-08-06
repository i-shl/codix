[中文](./README.zh-CN.md) | [English](./README.md)

# @voked/cli

voked 的命令行客户端：一个 **纯 ANSI 手写 TUI**（不依赖 ink / react 等终端框架），运行在 Node.js ≥ 20 上，Windows / macOS / Linux 通用。

底层复用 `@voked/core` 核心引擎。

## 一、从 GitHub 直接安装（推荐，无需 clone）

```bash
npm i -g github:i-shl/voked
```

安装会自动 `prepare` 构建 core + cli，并把 `voked` 命令加入全局 PATH。（全局安装只装 CLI 运行时依赖，**不下载 Electron**，速度快。需要 npm ≥ 8.5。）

安装后：

```bash
voked ./你的项目目录     # 在指定目录启动
voked --config          # 初始化配置
voked --list            # 列出历史会话
```

## 二、从源码运行 / 开发（pnpm）

```bash
git clone https://github.com/i-shl/voked.git
cd voked
pnpm install
pnpm build:cli             # 仅构建 core + cli
```

运行：

```bash
node packages/cli/dist/index.js ./你的项目目录
```

选项：

```
-m, --model <key>     指定默认模型
-r, --resume <id>     恢复会话
-l, --list            列出所有会话
-c, --config          创建/查看配置
-L, --lang <zh|en>    界面语言（默认 zh 中文；也可用环境变量 voked_LANG / LANG）
```

界面语言（英 / 中，默认中文）：

- 命令行：`voked --lang en ./项目目录`（或 `-L en`）直接切英文。
- 环境变量：`voked_LANG=en voked ./项目目录`，或用系统 `LANG=en_US.UTF-8`（带区域后缀也能识别）。
- 配置文件：`~/.voked/config.json` 加 `"ui": { "language": "en" }`，对所有 CLI 启动生效。

优先级：`--lang` > 环境变量 > 配置 `ui.language` > 默认（中文）。语言只影响界面文案，不影响模型回复语言。

首次使用先初始化配置：

```bash
node packages/cli/dist/index.js --config
# 编辑 ~/.voked/config.json 填入 API Key
```

## 三、Slash 命令（运行时）

```
/help                显示帮助
/exit, /quit         退出
/model [<key>]       列出或切换默认模型
/clear               清屏
/sessions            列出历史会话
/resume <id>         恢复会话
/new [title]         新建会话
/cd <dir>            切换项目目录
/mcp list            列出 MCP 服务器
/skills              列出已安装 skill
/install <src>       安装 skill
/tools               列出可用工具
/config show|path    配置信息
/rules [global]      查看规则文件
```

## 四、构建与发布

```bash
pnpm build:cli        # tsc 编译到 dist/
pnpm --filter @voked/cli test   # TUI 单测 + E2E（mock 模型，无需 Key）
```

发布到 npm registry：

```bash
npm publish           # 根 package.json 的 files 已限定只发布 cli + core 构建产物
```

> 本地链接调试：`pnpm link:cli` 会把 `voked` 命令软链到全局。

## 五、配置示例

`~/.voked/config.json`：

```json
{
  "ui": { "language": "zh" },
  "models": {
    "default": { "provider": "openai-compatible", "model": "gpt-4o", "apiKey": "sk-你的key", "baseURL": "https://api.openai.com/v1" }
  },
  "defaultModel": "default",
  "permissionRules": [],
  "mcpServers": []
}
```

API Key 仅存于本机 `~/.voked/`（被 git 忽略），不入源码。

## 关于本项目

voked 由 **CodeBuddy 的 hy3 模型**从 0 到 1 全程辅助开发完成。
