/**
 * 配置加载 - 多层级合并：
 *  1. 内置 defaults
 *  2. 全局 ~/.codix/config.json
 *  3. 项目 .codix/config.json
 *  4. 环境变量（覆盖）
 */
import path from 'node:path';
import { z } from 'zod';
import { CODIX_HOME, ensureDir, fileExists, readFileText, writeFileAtomic } from '../utils/fs.js';
import { deepMerge } from '../utils/common.js';
import { ConfigError } from '../errors.js';
import { getLogger } from '../logger.js';
import { DEFAULT_CONFIG } from './defaults.js';
import type { GlobalConfig } from '../types/config.js';

const log = getLogger('config');

/**
 * baseURL 容错：
 *  - 缺省 / 空串 → 视为未设置，由 provider 默认 baseURL 兜底
 *  - 非法值（如手误写入的 "2"）→ 不阻断整个配置加载，丢弃并回退默认
 *  - 合法的 http(s) URL → 保留
 */
const baseURLSchema = z.preprocess(
  (v: unknown) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'string' && !/^https?:\/\//i.test(v.trim())) {
      log.warn(`忽略非法 baseURL: ${JSON.stringify(v)}（已回退到 provider 默认）`);
      return undefined;
    }
    return typeof v === 'string' ? v.trim() : undefined;
  },
  z.string().url().optional(),
);

/** `openai` 为历史别名，等价于 `openai-compatible` */
const providerTypeSchema = z.enum([
  'openai-compatible',
  'openai-responses',
  'anthropic',
  'gemini',
  'openai',
]);

const modelConfigSchema = z.object({
  provider: providerTypeSchema,
  providerId: z.string().optional(),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseURL: baseURLSchema,
  headers: z.record(z.string()).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  contextWindow: z.number().int().positive().optional(),
  extra: z.record(z.unknown()).optional(),
});

const providerConfigSchema = z.object({
  label: z.string().optional(),
  type: providerTypeSchema,
  apiKey: z.string().optional(),
  baseURL: baseURLSchema,
  headers: z.record(z.string()).optional(),
});

const configSchema = z.object({
  defaultModel: z.string().optional(),
  providers: z.record(providerConfigSchema).optional(),
  models: z.record(modelConfigSchema).default({}),
  permissionRules: z
    .array(
      z.object({
        tool: z.string(),
        decision: z.enum(['allow', 'deny', 'ask', 'allowAll']),
        matcher: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .default([]),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        transport: z.enum(['stdio', 'sse', 'http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        cwd: z.string().optional(),
        url: z.string().optional(),
        headers: z.record(z.string()).optional(),
        enabled: z.boolean().optional(),
        autoConnect: z.boolean().optional(),
      })
    )
    .default([]),
  rulesPath: z.string().optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
  ui: z.object({ theme: z.enum(['light', 'dark', 'auto']).optional(), language: z.enum(['zh', 'en']).optional() }).optional(),
  webSearch: z
    .object({
      provider: z.enum(['brave', 'tavily', 'duckduckgo']),
      apiKey: z.string().optional(),
    })
    .optional(),
});

export function parseConfig(raw: unknown): GlobalConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError('Invalid config: ' + result.error.message);
  }
  return result.data as GlobalConfig;
}

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  await ensureDir(CODIX_HOME);
  const globalPath = path.join(CODIX_HOME, 'config.json');
  let merged: GlobalConfig = deepMerge<GlobalConfig>(DEFAULT_CONFIG, {} as GlobalConfig);
  if (await fileExists(globalPath)) {
    try {
      const text = await readFileText(globalPath);
      const parsed = parseConfig(JSON.parse(text));
      merged = deepMerge(merged, parsed);
    } catch (e) {
      throw new ConfigError(`Failed to parse ${globalPath}: ${(e as Error).message}`, e);
    }
  }
  return applyEnvOverrides(merged);
}

export async function loadProjectConfig(cwd: string): Promise<GlobalConfig | null> {
  const projectPath = path.join(cwd, '.codix', 'config.json');
  if (!(await fileExists(projectPath))) return null;
  try {
    const text = await readFileText(projectPath);
    return parseConfig(JSON.parse(text));
  } catch (e) {
    throw new ConfigError(`Failed to parse ${projectPath}: ${(e as Error).message}`, e);
  }
}

/** 全局+项目合并；项目级覆盖全局级 */
export async function loadMergedConfig(cwd: string): Promise<GlobalConfig> {
  const globalCfg = await loadGlobalConfig();
  const projectCfg = await loadProjectConfig(cwd);
  if (!projectCfg) return globalCfg;
  return deepMerge(globalCfg, projectCfg);
}

function applyEnvOverrides(cfg: GlobalConfig): GlobalConfig {
  const next = { ...cfg };
  // 环境变量覆盖：例如 CODIX_API_KEY、CODIX_BASE_URL、CODIX_MODEL
  const apiKey = process.env.CODIX_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.CODIX_BASE_URL || process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL;
  const modelName = process.env.CODIX_MODEL || process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL;
  if (apiKey || baseURL || modelName) {
    const key = next.defaultModel ?? '__env__';
    const cur = next.models[key] ?? { provider: 'openai', model: modelName ?? 'gpt-4o' } as GlobalConfig['models'][string];
    next.models[key] = {
      ...cur,
      apiKey: apiKey ?? cur.apiKey,
      baseURL: baseURL ?? cur.baseURL,
      model: modelName ?? cur.model,
    };
    next.defaultModel = key;
  }
  return next;
}

export async function saveGlobalConfig(cfg: GlobalConfig): Promise<void> {
  await ensureDir(CODIX_HOME);
  const p = path.join(CODIX_HOME, 'config.json');
  await writeFileAtomic(p, JSON.stringify(cfg, null, 2));
}

export async function saveProjectConfig(cwd: string, cfg: Partial<GlobalConfig>): Promise<void> {
  const dir = path.join(cwd, '.codix');
  await ensureDir(dir);
  const p = path.join(dir, 'config.json');
  let existing: GlobalConfig = DEFAULT_CONFIG;
  if (await fileExists(p)) {
    existing = parseConfig(JSON.parse(await readFileText(p)));
  }
  const merged = deepMerge<GlobalConfig>(existing, cfg);
  await writeFileAtomic(p, JSON.stringify(merged, null, 2));
}