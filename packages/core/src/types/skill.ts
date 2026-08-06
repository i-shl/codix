/**
 * Skill 类型
 */
export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  /** 提示词片段，会注入 system */
  prompt?: string;
  /** 注册的工具 */
  tools?: SkillToolDef[];
  /** 依赖的其他 skill/mcp */
  dependencies?: { skills?: string[]; mcp?: string[] };
  /** 元信息 */
  homepage?: string;
  repository?: string;
  tags?: string[];
}

export interface SkillToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 工具实现的 JS 入口文件，相对于 skill 根 */
  entry: string;
}

export interface Skill {
  manifest: SkillManifest;
  /** 安装路径 */
  path: string;
  /** 是否启用 */
  enabled: boolean;
}