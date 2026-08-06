[English](./README.md) | [中文](./README.zh-CN.md)

# @voked/core

Shared core engine. Both the CLI and Desktop depend on it.

## Modules

- **config** —— config loading (global + project + env merge)
- **models** —— multi-provider model adapter layer (OpenAI-compatible, Anthropic, Gemini)
- **tools** —— built-in tools (Read/Write/Edit/Bash/Glob/Grep/LS/WebFetch/WebSearch/TodoWrite)
- **permissions** —— permission engine (full-auto by default; tool calls execute directly)
- **mcp** —— MCP client (stdio / sse / http)
- **skills** —— Skill system (manifest protocol, installer, loader)
- **sessions** —— session persistence (JSON file storage)
- **rules** —— global / project rule loading
- **agent** —— Agent loop (ReAct-style) + context compaction
- **utils** —— fs / shell / common utilities

## Usage

```typescript
import { createAgentContext, runAgent } from '@voked/core';

const ctx = await createAgentContext('/path/to/project');
const handle = runAgent(ctx, sessionId, { text: 'Hello' }, {
  onEvent: (ev) => { if (ev.type === 'text_delta') process.stdout.write(ev.text); },
  onPermissionAsk: async (req) => 'allow',
});
await handle.promise;
```

## Build standalone

```bash
pnpm build
```
