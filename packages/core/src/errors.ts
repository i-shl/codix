/**
 * 错误类型
 */
export class vokedError extends Error {
  constructor(message: string, public readonly code?: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'vokedError';
  }
}

export class ConfigError extends vokedError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause);
    this.name = 'ConfigError';
  }
}

export class ToolError extends vokedError {
  constructor(message: string, public readonly toolName?: string, cause?: unknown) {
    super(message, 'TOOL_ERROR', cause);
    this.name = 'ToolError';
  }
}

export class ModelError extends vokedError {
  constructor(message: string, cause?: unknown) {
    super(message, 'MODEL_ERROR', cause);
    this.name = 'ModelError';
  }
}

export class PermissionError extends vokedError {
  constructor(message: string) {
    super(message, 'PERMISSION_DENIED');
    this.name = 'PermissionError';
  }
}

export class McpError extends vokedError {
  constructor(message: string, public readonly serverName?: string, cause?: unknown) {
    super(message, 'MCP_ERROR', cause);
    this.name = 'McpError';
  }
}

export class SkillError extends vokedError {
  constructor(message: string, public readonly skillName?: string, cause?: unknown) {
    super(message, 'SKILL_ERROR', cause);
    this.name = 'SkillError';
  }
}