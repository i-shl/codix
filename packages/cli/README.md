[English](./README.md) | [中文](./README.zh-CN.md)

# voked CLI

voked's command-line client: a **hand-written ANSI TUI** (no ink / react style terminal framework), running on Node.js ≥ 20, portable across Windows / macOS / Linux.

It reuses the `@voked/core` engine underneath.

## Install

```bash
npm i -g voked
voked ./your-project-dir     # start inside a project
voked --config               # create ~/.voked/config.json (then add your API key)
```

Requires **Node.js ≥ 20**. A global install only pulls CLI runtime deps and does **not** download Electron.

> The desktop client (Electron + Vue 3) is distributed as a prebuilt installer on
> GitHub Releases: https://github.com/i-shl/voked/releases (Windows available; macOS / Linux built manually).

## 1. Install from GitHub (no clone)

```bash
npm i -g github:i-shl/voked
```

Installation runs `prepare` automatically to build core + cli and adds the `voked` command to your global PATH. (A global install only pulls CLI runtime deps and **does not download Electron**, so it is fast. Requires npm ≥ 8.5.)

After install:

```bash
voked ./your-project-dir     # start in the given directory
voked --config              # initialize config
voked --list                # list session history
```

## 2. Run / develop from source (pnpm)

```bash
git clone https://github.com/i-shl/voked.git
cd voked
pnpm install
pnpm build:cli             # build core + cli only
```

Run:

```bash
node packages/cli/dist/index.js ./your-project-dir
```

Options:

```
-m, --model <key>     specify the default model
-r, --resume <id>     resume a session
-l, --list            list all sessions
-c, --config          create / view config
-L, --lang <zh|en>    UI language (default zh Chinese; also via env voked_LANG / LANG)
```

Interface language (English / 中文, default Chinese):

- CLI: `voked --lang en ./project-dir` (or `-L en`) switches to English.
- Env: `voked_LANG=en voked ./project-dir`, or use the system `LANG=en_US.UTF-8` (region suffix recognized).
- Config: add `"ui": { "language": "en" }` to `~/.voked/config.json` to apply to every CLI launch.

Priority: `--lang` > env > config `ui.language` > default (Chinese). Language only affects UI text, not the model's reply language.

Initialize config on first use:

```bash
node packages/cli/dist/index.js --config
# edit ~/.voked/config.json to add your API key
```

## 3. Slash commands (runtime)

```
/help                 show help
/exit, /quit         quit
/model [<key>]       list or switch the default model
/clear               clear screen
/sessions            list session history
/resume <id>         resume a session
/new [title]         start a new session
/cd <dir>            change project directory
/mcp list            list MCP servers
/skills              list installed skills
/install <src>       install a skill
/tools               list available tools
/config show|path    show config info
/rules [global]      view rule files
```

## 4. Build & publish

```bash
pnpm build:cli        # tsc compile to dist/
pnpm --filter @voked/cli test   # TUI unit + E2E (mock model, no key needed)
```

Publish to the npm registry:

```bash
npm publish           # root package.json files field limits publish to cli + core build outputs
```

> Local link for debugging: `pnpm link:cli` symlinks the `voked` command globally.

## 5. Config example

`~/.voked/config.json`:

```json
{
  "ui": { "language": "zh" },
  "models": {
    "default": { "provider": "openai-compatible", "model": "gpt-4o", "apiKey": "sk-your-key", "baseURL": "https://api.openai.com/v1" }
  },
  "defaultModel": "default",
  "permissionRules": [],
  "mcpServers": []
}
```

API keys live only in your local `~/.voked/` (git-ignored) and never enter the source.

## About this project

voked was built from 0 to 1 with the full assistance of the **CodeBuddy hy3 model**.
