/**
 * 默认配置
 */
import type { GlobalConfig } from '../types/config.js';

export const DEFAULT_CONFIG: GlobalConfig = {
  models: {},
  permissionRules: [
    { tool: 'Read', decision: 'allow', description: '读取文件默认可' },
    { tool: 'Glob', decision: 'allow', description: 'Glob 默认可' },
    { tool: 'Grep', decision: 'allow', description: 'Grep 默认可' },
    { tool: 'LS', decision: 'allow', description: 'LS 默认可' },
    { tool: 'WebFetch', decision: 'allow', description: 'WebFetch 默认可' },
    { tool: 'WebSearch', decision: 'allow', description: 'WebSearch 默认可' },
    { tool: 'Write', decision: 'ask', description: '写文件需询问' },
    { tool: 'Edit', decision: 'ask', description: '编辑文件需询问' },
    { tool: 'Bash', decision: 'ask', description: 'Bash 需询问' },
  ],
  mcpServers: [],
};