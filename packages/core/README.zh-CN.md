[中文](./README.zh-CN.md) | [English](./README.md)

# @voked/core

共享核心引擎。CLI 与 Desktop 都依赖它。

## 模块

- **config** —— 配置加载（全局 + 项目 + 环境变量合并）
- **models** —— 多 provider 模型适配层（OpenAI 兼容、Anthropic、Gemini）
- **tools** —— 内置工具（Read/Write/Edit/Bash/Glob/Grep/LS/WebFetch/WebSearch/TodoWrite）
- **permissions** —— 权限引擎（默认全自动，工具调用直接执行）
- **mcp** —— MCP 客户端（stdio / sse / http）
- **skills** —— Skill 系统（manifest 协议、安装器、加载器）
- **sessions** —— 会话持久化（JSON 文件存储）
- **rules** —— 全局 / 项目规则加载
- **agent** —— Agent 循环（ReAct 风格）+ 上下文压缩
- **utils** —— fs / shell / common 工具

## 用法

```typescript
import { createAgentContext, runAgent } from '@voked/core';

const ctx = await createAgentContext('/path/to/project');
const handle = runAgent(ctx, sessionId, { text: '你好' }, {
  onEvent: (ev) => { if (ev.type === 'text_delta') process.stdout.write(ev.text); },
  onPermissionAsk: async (req) => 'allow',
});
await handle.promise;
```

## 独立构建

```bash
pnpm build
```
