[English](./README.md) | [中文](./README.zh-CN.md)

# @codix/cli

codix's command-line client: a **hand-written ANSI TUI** (no ink / react style terminal framework), running on Node.js ≥ 20, portable across Windows / macOS / Linux.

It reuses the `@codix/core` engine underneath.

## 1. Install directly from GitHub (recommended, no clone)

```bash
npm i -g github:i-shl/codix
```

Installation runs `prepare` automatically to build core + cli and adds the `codix` command to your global PATH. (A global install only pulls CLI runtime deps and **does not download Electron**, so it is fast. Requires npm ≥ 8.5.)

After install:

```bash
codix ./your-project-dir     # start in the given directory
codix --config              # initialize config
codix --list                # list session history
```

## 2. Run / develop from source (pnpm)

```bash
git clone https://github.com/i-shl/codix.git
cd codix
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
-L, --lang <zh|en>    UI language (default zh Chinese; also via env CODIX_LANG / LANG)
```

Interface language (English / 中文, default Chinese):

- CLI: `codix --lang en ./project-dir` (or `-L en`) switches to English.
- Env: `CODIX_LANG=en codix ./project-dir`, or use the system `LANG=en_US.UTF-8` (region suffix recognized).
- Config: add `"ui": { "language": "en" }` to `~/.codix/config.json` to apply to every CLI launch.

Priority: `--lang` > env > config `ui.language` > default (Chinese). Language only affects UI text, not the model's reply language.

Initialize config on first use:

```bash
node packages/cli/dist/index.js --config
# edit ~/.codix/config.json to add your API key
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
pnpm --filter @codix/cli test   # TUI unit + E2E (mock model, no key needed)
```

Publish to the npm registry:

```bash
npm publish           # root package.json files field limits publish to cli + core build outputs
```

> Local link for debugging: `pnpm link:cli` symlinks the `codix` command globally.

## 5. Config example

`~/.codix/config.json`:

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

API keys live only in your local `~/.codix/` (git-ignored) and never enter the source.

## About this project

codix was built from 0 to 1 with the full assistance of the **CodeBuddy hy3 model**.
