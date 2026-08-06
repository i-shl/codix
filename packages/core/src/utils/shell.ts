/**
 * Shell 工具 - 不在这里执行命令，只做 quoting
 */
import os from 'node:os';

export function shellQuote(s: string, shell: 'bash' | 'cmd' | 'powershell' = process.platform === 'win32' ? 'powershell' : 'bash'): string {
  if (shell === 'bash') {
    if (s === '') return "''";
    if (/^[a-zA-Z0-9_\-./:]+$/.test(s)) return s;
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }
  if (shell === 'cmd') {
    return `"${s.replace(/"/g, '\\"').replace(/[%!^&|<>()]/g, '^$&')}"`;
  }
  // powershell
  return `'${s.replace(/'/g, `''`)}'`;
}

export function detectShell(): 'bash' | 'cmd' | 'powershell' | 'zsh' {
  if (process.platform === 'win32') {
    if (process.env.PSModulePath) return 'powershell';
    return 'cmd';
  }
  if (process.env.SHELL?.endsWith('zsh')) return 'zsh';
  return 'bash';
}

export function homedir(): string {
  return os.homedir();
}