/**
 * 日志 - 简单 stdout/stderr 适配，支持 verbose 级别
 */
import process from 'node:process';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogTransport {
  log(level: LogLevel, scope: string, message: string, data?: unknown): void;
}

class ConsoleTransport implements LogTransport {
  private thresholds: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  constructor(
    private level: LogLevel = 'info',
    private stream: { write(chunk: string): boolean | void } = process.stderr
  ) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setStream(stream: { write(chunk: string): boolean | void }): void {
    this.stream = stream;
  }

  log(level: LogLevel, scope: string, message: string, data?: unknown): void {
    if (this.thresholds[level] < this.thresholds[this.level]) return;
    const ts = new Date().toISOString();
    const head = `${ts} [${level.toUpperCase()}] [${scope}]`;
    const body = data === undefined ? message : `${message} ${JSON.stringify(data)}`;
    // 全部走 stderr — 不能污染 Ink 的 stdout（光标定位会乱）
    this.stream.write(`${head} ${body}\n`);
  }
}

/**
 * 判断是否应该静音。
 * - TTY 模式（Ink 渲染中）：默认只放行 warn/error，避免污染用户屏幕
 * - 非 TTY（脚本/管道）：保留 info，便于调试
 * - 显式设置 voked_LOG_LEVEL 时按显式值来
 */
function resolveDefaultLevel(): LogLevel {
  const env = process.env.voked_LOG_LEVEL as LogLevel | undefined;
  if (env && ['debug', 'info', 'warn', 'error'].includes(env)) return env;
  if (process.stdout.isTTY) return 'warn';
  return 'info';
}

function resolveStream(): { write(chunk: string): boolean | void } {
  // 支持把日志重定向到文件，避免出现在 TTY 屏幕上
  const file = process.env.voked_LOG_FILE;
  if (file) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      return fs.createWriteStream(file, { flags: 'a' });
    } catch {
      return process.stderr;
    }
  }
  return process.stderr;
}

export class Logger {
  private transport: LogTransport;
  private children = new Map<string, Logger>();

  constructor(public readonly scope: string, transport?: LogTransport) {
    this.transport = transport ?? new ConsoleTransport();
  }

  static setDefaultLevel(level: LogLevel): void {
    // 简单实现：每次构造都从 env 读
    process.env.voked_LOG_LEVEL = level;
  }

  child(scope: string): Logger {
    const fullScope = `${this.scope}:${scope}`;
    let child = this.children.get(fullScope);
    if (!child) {
      child = new Logger(fullScope, this.transport);
      this.children.set(fullScope, child);
    }
    return child;
  }

  debug(message: string, data?: unknown): void {
    this.transport.log('debug', this.scope, message, data);
  }
  info(message: string, data?: unknown): void {
    this.transport.log('info', this.scope, message, data);
  }
  warn(message: string, data?: unknown): void {
    this.transport.log('warn', this.scope, message, data);
  }
  error(message: string | Error, data?: unknown): void {
    if (message instanceof Error) {
      this.transport.log('error', this.scope, message.message, { stack: message.stack, ...(data as object | undefined) });
    } else {
      this.transport.log('error', this.scope, message, data);
    }
  }
}

let rootLogger: Logger | undefined;
export function getLogger(scope = 'core'): Logger {
  if (!rootLogger) {
    const level = resolveDefaultLevel();
    const stream = resolveStream();
    rootLogger = new Logger(scope, new ConsoleTransport(level, stream));
  }
  return rootLogger.child(scope);
}

export const logger = getLogger();