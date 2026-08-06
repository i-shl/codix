[English](./README.md) | [中文](./README.zh-CN.md)

# voked Desktop

voked's desktop client: an AI Agent client built with **Electron + Vue 3 + Vite**.

It reuses the `@voked/core` engine and shares the same tools / models / MCP / Skills capabilities with the CLI.

## Supported platforms

| Platform | Installer | Package command |
|---|---|---|
| Windows | NSIS `.exe` (`voked-Setup-x.y.z.exe`) | `pnpm package:desktop:win` |
| macOS | `.dmg` | `pnpm package:desktop:mac` |
| Linux | `.AppImage` / `.deb` | `pnpm package:desktop:linux` |

> Packaging must run on the **target platform with network access** (electron-builder downloads that platform's Electron binary).
> App icons: `build/icon.png` and `build/icon.ico`, replaceable.

## 1. Run / develop from source (pnpm)

```bash
git clone https://github.com/i-shl/voked.git
cd voked
pnpm install
pnpm build:desktop        # build renderer + main process first
```

Dev mode (hot reload):

```bash
pnpm dev:desktop
# equivalent to: Vite dev server (renderer) + tsc watch (main process) + launch Electron
```

One-off launch (built artifacts):

```bash
cd packages/desktop && npx electron .
```

## 2. Packaging (publish to GitHub Releases)

Prebuilt Windows installers are published on GitHub Releases:
https://github.com/i-shl/voked/releases

On the **target platform** (only the Windows build is provided prebuilt on Releases; **macOS and Linux installers must be built manually** or via CI):

```bash
# Windows
pnpm package:desktop:win

# macOS
pnpm package:desktop:mac

# Linux
pnpm package:desktop:linux
```

Artifacts land in `packages/desktop/release/` (ignored by `.gitignore`, not committed).

- Windows: NSIS installer with "choose install directory" and "desktop shortcut".
- macOS: `dmg`, category `developer-tools`.
- Linux: `AppImage` and `deb`, category `Development`.

The electron-builder config lives in this directory's `package.json` `build` field; `after-pack.cjs` copies pnpm-isolated dependencies into the packaged app.

## 3. Features

- Multi-tab: Chat / History / Skills / MCP / Rules / Settings
- Model configuration, MCP server management
- Paste images, attach files (any type)
- Project switching
- Full-auto mode: tool calls execute directly without per-step confirmation
- Interface language (English / 中文, default Chinese): open **Settings → Language** and click **中文 / English** to switch instantly; the choice is written to both `localStorage` and the global config `ui.language`, and the CLI reuses it.

## 4. Testing

```bash
pnpm --filter @voked/desktop test   # message-queue unit tests
pnpm --filter @voked/desktop typecheck
```

## Notes

The desktop client and the CLI share the model / MCP / Skills config in `~/.voked/config.json` (initialize it once with the CLI's `--config`; the desktop can read it too).

## About this project

voked was built from 0 to 1 with the full assistance of the **CodeBuddy hy3 model**.
