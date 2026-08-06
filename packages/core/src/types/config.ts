/**
 * 全局配置类型
 */
import type { ModelConfig, ProviderConfig } from './model.js';
import type { PermissionRule } from './permission.js';
import type { McpServerConfig } from './mcp.js';

export interface GlobalConfig {
  /** 默认模型 key（指向 models.xxx） */
  defaultModel?: string;
  /** 供应商表：一个供应商下可挂多个模型 */
  providers?: Record<string, ProviderConfig>;
  models: Record<string, ModelConfig>;
  permissionRules: PermissionRule[];
  mcpServers: McpServerConfig[];
  /** 全局规则文件路径（可被项目级覆盖） */
  rulesPath?: string;
  /** 工具启用/禁用 */
  enabledTools?: string[];
  disabledTools?: string[];
  /** UI 偏好 */
  ui?: {
    theme?: 'light' | 'dark' | 'auto';
    language?: 'zh' | 'en';
  };
  /** 网络搜索 API（可选，若未配置 WebSearch 工具不可用） */
  webSearch?: {
    provider: 'brave' | 'tavily' | 'duckduckgo';
    apiKey?: string;
  };
}