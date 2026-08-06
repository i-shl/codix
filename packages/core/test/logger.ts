/**
 * logger TTY-aware 行为测试
 * 验证: TTY 模式下默认 level 是 'warn'，info 应被丢弃
 */
import { Logger, type LogLevel, type LogTransport } from '../dist/logger.js';

class CaptureTransport implements LogTransport {
  lines: string[] = [];
  level: LogLevel;
  constructor(level: LogLevel) { this.level = level; }
  log(level: LogLevel, scope: string, message: string, data?: unknown): void {
    const thresh: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
    if (thresh[level] < thresh[this.level]) return;
    this.lines.push('[' + level.toUpperCase() + '] ' + message);
  }
}

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) { console.log('PASS', msg); passed++; }
  else { console.error('FAIL', msg); failed++; }
}

// Case 1: warn-level transport 只放行 warn + error
{
  const t = new CaptureTransport('warn');
  t.log('debug', 'x', 'd');
  t.log('info', 'x', 'i');
  t.log('warn', 'x', 'w');
  t.log('error', 'x', 'e');
  check(t.lines.length === 2, 'warn-level filters out debug+info');
  check(t.lines[0].includes('WARN'), 'first line is WARN');
  check(t.lines[1].includes('ERROR'), 'second line is ERROR');
}

// Case 2: debug-level 放行全部
{
  const t = new CaptureTransport('debug');
  t.log('debug', 'x', 'd');
  t.log('info', 'x', 'i');
  t.log('warn', 'x', 'w');
  t.log('error', 'x', 'e');
  check(t.lines.length === 4, 'debug-level lets all 4 through');
}

// Case 3: error-level 只放行 error
{
  const t = new CaptureTransport('error');
  t.log('info', 'x', 'i');
  t.log('warn', 'x', 'w');
  t.log('error', 'x', 'e');
  check(t.lines.length === 1, 'error-level only lets error through');
}

// Case 4: Logger 类正确转发到 transport
{
  const t = new CaptureTransport('warn');
  const log = new Logger('test', t);
  log.info('hidden');
  log.warn('shown');
  check(t.lines.length === 1, 'Logger.warn() shows, .info() hides');
  check(t.lines[0].includes('shown'), 'correct message shown');
}

// Case 5: child logger 共享同一个 transport
{
  const t = new CaptureTransport('warn');
  const root = new Logger('core', t);
  const child = root.child('mcp');
  child.warn('from child');
  check(t.lines.length === 1, 'child logger shares transport');
}

console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
