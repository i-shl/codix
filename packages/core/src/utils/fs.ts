/**
 * 路径/文件系统工具
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ToolError } from '../errors.js';

export const HOME_DIR = os.homedir();
export const voked_HOME = path.join(HOME_DIR, '.voked');

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readFileText(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}

export async function readFileBuffer(p: string): Promise<Buffer> {
  return fs.readFile(p);
}

export async function writeFileAtomic(p: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(p);
  await ensureDir(dir);
  const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, p);
}

export function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

/** 检查目标路径是否在白名单根中（防止越权读写） */
export function isPathInside(target: string, root: string): boolean {
  const abs = path.resolve(target);
  const r = path.resolve(root);
  if (abs === r) return true;
  const rel = path.relative(r, abs);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function safeStat(p: string): Promise<import('node:fs').Stats | null> {
  return fs.stat(p).catch(() => null);
}