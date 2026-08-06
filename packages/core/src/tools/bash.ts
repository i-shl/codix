/**
 * Bash - 执行 shell 命令
 */
import { spawn } from 'node:child_process';
import { BaseTool, jsonSchema } from './base.js';
import type { ToolContext } from '../types/tool.js';

const TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/** 子进程可注入的 env 黑名单：这些 key 可劫持子进程（LD_PRELOAD、动态链接器、Node 注入等） */
const FORBIDDEN_ENV_KEYS = new Set([
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_DEBUG',
  'PYTHONPATH', 'PYTHONSTARTUP',
  'RUBYOPT',
  'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS',
  'PATH', 'PATHEXT', 'SystemRoot', 'ComSpec', 'SHELL',
  'IFS',
]);

export class BashTool extends BaseTool<{ command: string; timeout?: number; cwd?: string; env?: Record<string, string> }> {
  readonly source = { type: 'builtin' } as const;
  readonly schema = jsonSchema(
    'Bash',
    '执行 shell 命令。返回 stdout/stderr/exit code。可指定 timeout (ms) 和 cwd。',
    {
      command: { type: 'string', description: '要执行的命令' },
      timeout: { type: 'integer', description: '超时毫秒（默认 5min）' },
      cwd: { type: 'string', description: '命令执行的工作目录（绝对路径，可指向本机任意目录，例如 C:\\Users\\用户名\\Desktop）；省略则使用工作目录 cwd' },
      env: { type: 'object', additionalProperties: { type: 'string' }, description: '额外环境变量（黑名单 key 会被过滤）' },
    },
    ['command']
  );

  renderUse(input: { command: string }): string {
    return `$ ${truncate(input.command, 200)}`;
  }

  async execute(input: { command: string; timeout?: number; cwd?: string; env?: Record<string, string> }, ctx: ToolContext): Promise<import('../types/message.js').ToolResult> {
    const isWin = process.platform === 'win32';
    const shell = isWin ? (process.env.COMSPEC ?? 'cmd.exe') : '/bin/bash';
    const args = isWin ? ['/d', '/s', '/c', input.command] : ['-lc', input.command];
    // 仅透传安全子集的环境变量
    const safeUserEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.env ?? {})) {
      if (FORBIDDEN_ENV_KEYS.has(k)) continue;
      safeUserEnv[k] = v;
    }
    const env = { ...process.env, ...safeUserEnv } as NodeJS.ProcessEnv;
    const cwd = input.cwd ?? ctx.cwd;

    return new Promise((resolve) => {
      const child = spawn(shell, args, { cwd, env, windowsHide: true });
      let stdout = '';
      let stderr = '';
      let killed = false;
      const timeout = input.timeout ?? TIMEOUT_MS;
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeout);
      // 监听外部 abort
      const onAbort = (): void => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000);
      };
      if (ctx.signal) {
        if (ctx.signal.aborted) onAbort();
        else ctx.signal.addEventListener('abort', onAbort, { once: true });
      }
      child.stdout.on('data', (b) => {
        stdout += b.toString('utf8');
        if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000) + '\n[truncated]\n';
      });
      child.stderr.on('data', (b) => {
        stderr += b.toString('utf8');
        if (stderr.length > 50_000) stderr = stderr.slice(0, 50_000) + '\n[truncated]\n';
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
        resolve({ toolCallId: '', content: `Error: ${err.message}`, isError: true });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
        const header = killed ? `[killed: timeout ${timeout}ms]` : `[exit ${code ?? signal}]`;
        const body = `# stdout\n${stdout || '(empty)'}\n# stderr\n${stderr || '(empty)'}`;
        resolve({
          toolCallId: '',
          content: `${header}\n${body}`,
          isError: (code !== 0 || killed) && !stdout.length,
        });
      });
    });
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 3) + '...';
}