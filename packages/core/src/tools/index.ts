/**
 * 工具集合 - 创建一个包含所有内置工具的注册表
 */
import { ToolRegistry } from './registry.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';
import { EditTool } from './edit.js';
import { BashTool } from './bash.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { LSTool } from './ls.js';
import { WebFetchTool } from './webfetch.js';
import { WebSearchTool } from './websearch.js';
import { TodoWriteTool } from './todo.js';
import type { GlobalConfig } from '../types/config.js';

export function createBuiltinRegistry(cfg?: GlobalConfig): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(new ReadTool());
  reg.register(new WriteTool());
  reg.register(new EditTool());
  reg.register(new BashTool());
  reg.register(new GlobTool());
  reg.register(new GrepTool());
  reg.register(new LSTool());
  reg.register(new WebFetchTool());
  reg.register(new WebSearchTool(cfg?.webSearch ? { provider: cfg.webSearch.provider, apiKey: cfg.webSearch.apiKey } : undefined));
  reg.register(new TodoWriteTool());

  // 应用 enabled/disabled 过滤
  if (cfg?.enabledTools || cfg?.disabledTools) {
    const enabled = cfg.enabledTools;
    const disabled = new Set(cfg.disabledTools ?? []);
    for (const t of reg.list()) {
      if (disabled.has(t.schema.name)) reg.unregister(t.schema.name);
      else if (enabled && !enabled.includes(t.schema.name)) reg.unregister(t.schema.name);
    }
  }
  return reg;
}