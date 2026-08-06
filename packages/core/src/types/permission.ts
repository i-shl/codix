/**
 * 权限类型
 */
export type PermissionDecision = 'allow' | 'deny' | 'ask' | 'allowAll';

export interface PermissionRule {
  /** 工具名，"*" 匹配所有 */
  tool: string;
  /** 动作 */
  decision: PermissionDecision;
  /** 限定参数匹配（JSON Pointer 风格，例如 input.command） */
  matcher?: string;
  /** 描述 */
  description?: string;
}

export interface PermissionAskRequest {
  tool: string;
  input: Record<string, unknown>;
  description: string;
  /** 三选项（全自动模式下一般不会触发询问） */
  options: {
    allow: string;
    deny: string;
    allowAll?: string;
  };
}