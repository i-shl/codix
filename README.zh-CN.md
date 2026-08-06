[中文](./README.zh-CN.md) | [English](./README.md)

# voked

voked 是一个 AI Agent，同时提供**命令行（CLI）**与**桌面端（Electron + Vue 3）**两种形态，底层共享同一套核心引擎 `@voked/core`。

## voked 是什么？

voked（取 "code" 与 "ix" 组合）是一个本地运行的 AI 编程助手。你把它指向一个项目目录，它就能读取文件、编辑代码、执行命令、调用工具，并串联 MCP 服务器与技能（skill）——全部由你选定的大模型驱动。同一套引擎驱动两种前端：轻量的 ANSI 终端界面，以及完整的 Electron 桌面端，可按习惯自由选择。

## 功能

- 工具调用：Read / Write / Edit / Bash / Glob / Grep / LS / WebFetch / WebSearch / TodoWrite
- MCP：连接任意 MCP 服务器（stdio / sse / http 三种 transport）
- 技能：manifest 协议，支持本地目录 / npm / git / tarball 安装
- 多模型：OpenAI 兼容、Anthropic、Gemini，运行时自由切换
- 会话与历史：JSON 文件持久化、列表、恢复
- 多模态：粘贴图片、附加文件
- 全局 / 项目级规则（`~/.voked/rules.md`、`<project>/.voked/rules.md`）
- 上下文压缩：超过阈值自动压缩

> **权限模式：** voked 默认处于「全自动」模式，工具调用直接执行，无需逐次确认。

## 安装

### CLI —— 从 npm

```bash
npm i -g voked
voked ./你的项目目录       # 在项目目录中启动
voked --config            # 生成 ~/.voked/config.json（随后填入 API Key）
voked --help
```

需要 **Node.js ≥ 20**。全局安装只拉取 CLI 运行时依赖，**不会下载 Electron**，因此很快。

> 想从源码装？也可以 `npm i -g github:i-shl/voked`（会克隆并构建）。

### 桌面端 —— 从 GitHub Releases

预构建的安装包发布在 GitHub Releases：

- **Windows**：在以下地址下载 `voked-Setup-x.y.z.exe`（NSIS 安装包）
  https://github.com/i-shl/voked/releases
- **macOS / Linux**：原生安装包必须在对应平台上手动构建（见下方「打包」章节），后续可能会通过 CI 提供。

## 支持的平台

| 形态 | Windows | macOS | Linux |
|---|:---:|:---:|:---:|
| CLI（Node.js） | ✅ | ✅ | ✅ |
| 桌面端（Electron） | ✅（NSIS 安装包） | ✅（DMG） | ✅（AppImage / deb） |

- 只要有 **Node.js ≥ 20**，CLI 即可在三者上运行。
- 桌面端安装包由 electron-builder 生成，见下方「打包」章节。
- 本仓库主要在 **Windows** 上开发与验证。

## 仓库结构（pnpm monorepo）

```
voked/
├── packages/
│   ├── core/        共享核心（Agent / 工具 / MCP / 模型 / Skill / 会话 / 规则）
│   ├── cli/         纯 ANSI 手写 TUI 的命令行客户端（无第三方终端框架）
│   └── desktop/     Electron + Vue 3 + Vite 桌面端
├── examples/        示例（skills 等）
├── LICENSE          MIT
└── README.md        本文件的英文版
```

CLI 与桌面端都依赖 `@voked/core`，核心引擎只写一份。

## 一、从源码运行 / 开发（pnpm）

适合想改代码或本地跑最新版的用户。

### 安装 Node.js ≥ 20 与 pnpm

```bash
# 安装 pnpm（如未安装）
npm i -g pnpm
```

### 安装依赖并构建

```bash
git clone https://github.com/i-shl/voked.git
cd voked
pnpm install      # 会自动执行 prepare，构建 core + cli
pnpm build        # 构建全部（core / cli / desktop）
```

### 初始化配置

```bash
node packages/cli/dist/index.js --config
```

会创建 `~/.voked/config.json`，编辑它填入 API Key：

```json
{
  "models": {
    "default": {
      "provider": "openai-compatible",
      "model": "gpt-4o",
      "apiKey": "sk-你的key",
      "baseURL": "https://api.openai.com/v1"
    },
    "claude": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "apiKey": "sk-ant-你的key"
    },
    "deepseek": {
      "provider": "openai-compatible",
      "model": "deepseek-chat",
      "apiKey": "sk-你的key",
      "baseURL": "https://api.deepseek.com/v1"
    }
  },
  "defaultModel": "default",
  "permissionRules": [],
  "mcpServers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  ]
}
```

> API Key 只存在于你本机的 `~/.voked/`（已被 `.gitignore` 忽略），**不会进入源码仓库**。

### 启动

```bash
# CLI
node packages/cli/dist/index.js ./你的项目目录

# 桌面端（开发模式，需先 pnpm build:desktop）
pnpm dev:desktop
# 或仅启动一次：
pnpm build:desktop && cd packages/desktop && npx electron .
```

## 二、通过 npm 从 GitHub 安装 CLI（无需 clone）

只想用 CLI、不想碰源码，可以直接从 GitHub 安装：

```bash
npm i -g github:i-shl/voked
```

安装过程会：

1. 克隆仓库并安装依赖；
2. 自动执行 `prepare` 脚本构建 `@voked/core` 与 `@voked/cli`；
3. 把 `voked` 命令链接到全局 PATH。

安装完成后即可在任意目录使用：

```bash
voked ./你的项目目录
voked --config      # 初始化配置
voked --list        # 列出历史会话
```

> 说明：全局安装只装 CLI 所需的运行时依赖（含 `@voked/core`），**不会下载 Electron**，所以安装很快。若 npm 版本较旧（< 8.5），请先 `npm i -g npm@latest`。

## 三、打包（发布到 GitHub Releases）

### 桌面端安装包

预构建的 Windows 安装包已发布在 GitHub Releases：
https://github.com/i-shl/voked/releases

要自己生成安装包，需在 **对应平台 + 有网络** 的环境下执行（打包会下载该平台的 Electron 二进制）。目前 **Releases 上仅提供 Windows 构建**；**macOS 与 Linux 的安装包需手动构建**（或通过 CI）：

```bash
# Windows → voked-Setup-x.y.z.exe（NSIS）  [已在 Releases 提供]
pnpm package:desktop:win

# macOS → voked-x.y.z.dmg  （在 macOS 上手动构建）
pnpm package:desktop:mac

# Linux → voked-x.y.z.AppImage 与 .deb  （在 Linux 上手动构建）
pnpm package:desktop:linux
```

产物位于 `packages/desktop/release/`（已被 `.gitignore` 忽略，不应入库）。

- 应用图标位于 `packages/desktop/build/icon.png` 与 `icon.ico`，可自行替换。
- Windows NSIS 安装包支持「选择安装目录」「桌面快捷方式」。

### CLI 发布到 npm

CLI 以根包 `voked` 的形式发布到 npm registry。根 `package.json` 的 `files` 已包含 `packages/cli` 与 `packages/core` 的构建产物——核心引擎随包一起打包，`bin` 为 `voked` 命令，安装后无需再拉取 `@voked/core`。

```bash
# 1. 先构建全部（也可不手动构建，npm publish 时的 prepare 会自动再构建一次）
pnpm build

# 2. 发布（需先 npm login，且对 voked 包有发布权限）
npm publish
```

发布后用户安装使用：

```bash
npm i -g voked
voked ./你的项目目录
voked --config
```

> 说明：
> - `npm publish` 会执行 `prepare`（`tsc -p packages/core/tsconfig.json && tsc -p packages/cli/tsconfig.json`）自动构建 core 与 cli。
> - 桌面端不发布到 npm，仅通过上面的「打包」产出安装包上传到 GitHub Releases。

## 四、CLI 使用

- 直接输入消息，Enter 发送
- 输入 `/` 显示所有命令
- `/model claude` 切换模型
- `/cd ..` 切换项目目录
- `/install npm:xxx` 安装 skill

Slash 命令：

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

CLI 选项：

```
-m, --model <key>     指定默认模型
-r, --resume <id>     恢复会话
-l, --list            列出所有会话
-c, --config          创建/查看配置
```

## 五、目录约定

- `~/.voked/` — 全局配置、会话、技能（**含 API Key，已被 git 忽略**）
- `<project>/.voked/` — 项目级配置、规则、skills
- `~/.voked/rules.md` — 全局规则
- `<project>/.voked/rules.md` — 项目级规则
- `~/.voked/sessions/` — 会话存储
- `~/.voked/skills/` — 全局 skill

## 界面语言（中 / 英）

voked 内置中英双语界面，**界面默认中文（zh）**。

- **CLI**：启动前按以下优先级确定语言：`--lang` / `-L` > 环境变量 `voked_LANG` 或 `LANG` > 配置文件 `ui.language` > 默认（中文）。
  - 命令行参数：`voked --lang en ./项目目录`（或 `-L en`）切换到英文。
  - 环境变量：`voked_LANG=en voked ./项目目录`，或直接用系统 `LANG=en_US.UTF-8`（带区域后缀也能识别）。
  - 配置文件：`~/.voked/config.json` 里加 `"ui": { "language": "en" }`，对所有 CLI 启动生效。
- **桌面端**：打开「设置 → 语言」，点「中文 / English」即可即时切换；选择会写入 `localStorage` 并同步到全局配置 `ui.language`，供 CLI 复用。

> 语言切换只影响界面文案，不影响模型回复的语言。

## 六、测试

```bash
pnpm test                 # 全部（core + desktop + cli）
pnpm -r typecheck         # 类型检查
pnpm -r build             # 构建全部
```

- CLI：TUI 单元测试 + E2E（mock 模型 HTTP server），无需真实 Key。
- Desktop：消息队列单元测试。
- Core：离线用例（smoke / agent / adapters / markdown 等）无需 Key；联网用例（advanced / suite-a / integration）需要真实模型 Key。

## 七、Skill 协议

```json
// manifest.json
{
  "name": "my-skill",
  "version": "0.1.0",
  "description": "My skill",
  "prompt": "可选，注入 system prompt 的片段",
  "tools": [
    {
      "name": "my_tool",
      "description": "工具说明",
      "inputSchema": { "type": "object", "properties": { } },
      "entry": "./tools/my-tool.js"
    }
  ]
}
```

```js
// tools/my-tool.js
export default {
  async execute(input, ctx) {
    return { toolCallId: '', content: 'result' };
  },
  renderUse(input) {
    return `MyTool ${JSON.stringify(input)}`;
  },
};
```

## 关于本项目

voked 由 **CodeBuddy 的 hy3 模型**从 0 到 1 全程辅助开发完成——架构设计、编码、测试与文档均在一次连续的 AI 协作中产出。

## License

[MIT](./LICENSE)
