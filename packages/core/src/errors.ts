/**
 * 错误类型
 */
export class codixError extends Error {
  constructor(message: string, public readonly code?: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'codixError';
  }
}

export class ConfigError extends codixError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause);
    this.name = 'ConfigError';
  }
}

export class ToolError extends codixError {
  constructor(message: string, public readonly toolName?: string, cause?: unknown) {
    super(message, 'TOOL_ERROR', cause);
    this.name = 'ToolError';
  }
}

export class ModelError extends codixError {
  constructor(message: string, cause?: unknown) {
    super(message, 'MODEL_ERROR', cause);
    this.name = 'ModelError';
  }
}

export class PermissionError extends codixError {
  constructor(message: string) {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionError';
  }
}

export class McpError extends codixError {
  constructor(message: string, public readonly serverName?: string, cause?: unknown) {
    super(message, 'MCP_ERROR', cause);
    this.name = 'McpError';
  }
}

export class SkillError extends codixError {
  constructor(message: string, public readonly skillName?: string, cause?: unknown) {
    super(message, 'SKILL_ERROR', cause);
    this.name = 'SkillError';
  }
}