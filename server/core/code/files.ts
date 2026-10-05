import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveProjectPath } from '../projects/files';
import { changedFiles, listFiles, trackedStats, type GitChange, type LineStat } from './git';

export const MAX_FILE_SIZE = 1024 * 1024;
export class CodeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function codePath(root: string, file: string, allowRoot = false): string {
  try {
    const full = resolveProjectPath(root, file);
    const rel = path.relative(resolveProjectPath(root, ''), full);
    if ((!allowRoot && !rel) || rel.split(path.sep).some(p => p.toLowerCase() === '.git'))
      throw new Error('Invalid code path');
    return full;
  } catch { throw new CodeError('Invalid code path'); }
}

export const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
};
export interface CodeFile {
  path: string; size: number; kind: 'text' | 'image' | 'binary' | 'too-large';
  content?: string; mime?: string;
}

/** Bounded read, even if the file grows after stat. */
export async function readBytes(root: string, file: string): Promise<{ size: number; bytes?: Buffer }> {
  const full = codePath(root, file);
  const handle = await fs.open(full, 'r').catch(error => {
    if (error.code === 'ENOENT') throw new CodeError('File not found', 404);
    throw error;
  });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new CodeError('Not a regular file');
    if (stat.size > MAX_FILE_SIZE) return { size: stat.size };
    const buffer = Buffer.alloc(MAX_FILE_SIZE + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    return length > MAX_FILE_SIZE ? { size: length } : { size: length, bytes: buffer.subarray(0, length) };
  } finally { await handle.close(); }
}

export function isBinary(bytes: Buffer): boolean {
  if (bytes.includes(0)) return true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return false; }
  catch { return true; }
}

export async function readCodeFile(root: string, file: string): Promise<CodeFile> {
  const { size, bytes } = await readBytes(root, file);
  const rel = path.relative(codePath(root, '', true), codePath(root, file)).replace(/\\/g, '/');
  if (!bytes) return { path: rel, size, kind: 'too-large' };
  const mime = imageTypes[path.extname(file).toLowerCase()];
  if (mime) return { path: rel, size, kind: 'image', mime };
  if (isBinary(bytes)) return { path: rel, size, kind: 'binary' };
  return { path: rel, size, kind: 'text', content: bytes.toString('utf8') };
}

export interface TreeEntry {
  name: string; path: string; directory: boolean; ignored: boolean;
  status?: GitChange['status']; changes: number;
}

/** Only the requested directory is returned; children are loaded on expansion. */
export async function fileTree(root: string, directory = '', includeIgnored = false): Promise<TreeEntry[]> {
  const full = codePath(root, directory, true);
  const [entries, visible, changes] = await Promise.all([
    fs.readdir(full, { withFileTypes: true }), listFiles(root), changedFiles(root),
  ]);
  const visiblePaths = new Set(visible);
  const visibleDirs = new Set<string>();
  for (const file of visible) {
    for (let i = file.indexOf('/'); i >= 0; i = file.indexOf('/', i + 1)) visibleDirs.add(file.slice(0, i));
  }
  const dir = path.relative(codePath(root, '', true), full).replace(/\\/g, '/');
  const result: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name.toLowerCase() === '.git') continue;
    const rel = dir ? dir + '/' + entry.name : entry.name;
    // Do not expose symlinks outside the project.
    try { codePath(root, rel); } catch { continue; }
    const directory = entry.isDirectory();
    if (!directory && !entry.isFile()) continue;
    const ignored = !(directory ? visibleDirs : visiblePaths).has(rel);
    if (ignored && !includeIgnored) continue;
    const affected = changes.filter(c => c.path === rel || (directory && c.path.startsWith(rel + '/')));
    result.push({ name: entry.name, path: rel, directory, ignored,
      changes: affected.length, status: directory ? undefined : affected[0]?.status });
  }
  return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

/** Per-file `+/−` of everything that differs from HEAD; untracked text files count as fully added. */
export async function changeStats(root: string): Promise<Record<string, LineStat>> {
  const [stats, changes] = await Promise.all([trackedStats(root), changedFiles(root)]);
  await Promise.all(changes.filter(change => change.status === '?').map(async change => {
    try {
      const { bytes } = await readBytes(root, change.path);
      if (!bytes) stats[change.path] = { added: 0, deleted: 0, binary: true };
      else if (isBinary(bytes)) stats[change.path] = { added: 0, deleted: 0, binary: true };
      else {
        const text = bytes.toString('utf8');
        stats[change.path] = { added: text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0), deleted: 0 };
      }
    } catch { /* vanished or unreadable: no counters */ }
  }));
  return stats;
}
