/**
 * CLI ↔ core 胶水层
 */
import {
  createAgentContext as _createContext,
  runAgent as _runAgent,
  createAdapter,
  inferProvider,
  resolveModelConfig,
  loadGlobalConfig,
  saveGlobalConfig,
  SessionManager,
  t,
  type AgentContext,
  type AgentRunOptions,
  type AgentRunHandle,
} from '../../core/dist/index.js';

export type codixContext = AgentContext;
export const createContext = _createContext;
export const runAgent = _runAgent;
export type { AgentRunOptions, AgentRunHandle };
export { SessionManager };

/**
 * 就地换模型：只重建 adapter，不重建整个 context
 * （重建 context 会重连 MCP、重扫 skill，切个模型不值当）
 */
export function applyModel(ctx: codixContext, key: string): void {
  const raw = ctx.config.models[key];
  if (!raw) throw new Error(t('model.notFound', { key }));
  const cfg = resolveModelConfig(raw, ctx.config.providers);
  ctx.model = createAdapter({ ...cfg, provider: cfg.provider ?? inferProvider(cfg.model) });
  ctx.config.defaultModel = key;
}

/** 把 defaultModel 持久化到全局配置，不碰其他字段 */
export async function persistPreference(patch: { defaultModel?: string }): Promise<void> {
  const global = await loadGlobalConfig();
  if (patch.defaultModel !== undefined) global.defaultModel = patch.defaultModel;
  await saveGlobalConfig(global);
}
