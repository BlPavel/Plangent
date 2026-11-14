import { DomainError } from '../../models/domain-error';
import type { CodeFile, TreeEntry } from '@contracts';
export type { CodeFile, TreeEntry } from '@contracts';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitChange } from '@contracts';
import { viewedChanges, visibleDirectories, visibleFiles } from './repository-state';

export const MAX_FILE_SIZE = 1024 * 1024;


export { codePath } from './paths';
import { codePath } from './paths';

export const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
};


/** Bounded read, even if the file grows after stat. */
export async function readBytes(root: string, file: string): Promise<{ size: number; bytes?: Buffer }> {
  const full = codePath(root, file);
  const handle = await fs.open(full, 'r').catch(error => {
    if (error.code === 'ENOENT') throw new DomainError('File not found', 404);
    throw error;
  });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new DomainError('Not a regular file');
    if (stat.size > MAX_FILE_SIZE) return { size: stat.size };
    // Sized by stat (one spare byte detects growth); a file that grew gets the full bound.
    let buffer = Buffer.allocUnsafe(stat.size + 1);
    let length = 0;
    while (true) {
      if (length === buffer.length) {
        if (buffer.length > MAX_FILE_SIZE) break;
        const larger = Buffer.allocUnsafe(MAX_FILE_SIZE + 1);
        buffer.copy(larger, 0, 0, length);
        buffer = larger;
      }
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



/** Only the requested directory is returned; children are loaded on expansion. */
export async function fileTree(root: string, directory = '', includeIgnored = false): Promise<TreeEntry[]> {
  const full = codePath(root, directory, true);
  const [entries, visible, visibleDirs, changes] = await Promise.all([
    fs.readdir(full, { withFileTypes: true }), visibleFiles(root), visibleDirectories(root), viewedChanges(root),
  ]);
  const visiblePaths = new Set(visible);
  const dir = path.relative(codePath(root, '', true), full).replace(/\\/g, '/');
  // Changes of this level by entry name: a file's own status, a folder's count of changed files inside.
  const prefix = dir ? dir + '/' : '';
  const affected = new Map<string, GitChange[]>();
  for (const change of changes) {
    if (!change.path.startsWith(prefix)) continue;
    const slash = change.path.indexOf('/', prefix.length);
    const name = change.path.slice(prefix.length, slash < 0 ? undefined : slash);
    const list = affected.get(name);
    if (list) list.push(change); else affected.set(name, [change]);
  }
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
    const group = affected.get(entry.name) ?? [];
    const own = directory ? group : group.filter(c => c.path === rel);
    result.push({ name: entry.name, path: rel, directory, ignored,
      changes: own.length, status: directory ? undefined : own[0]?.status });
  }
  return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

