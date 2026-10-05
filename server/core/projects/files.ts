import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// File index for the chat composer's @-mentions. Prefers `git ls-files` (fast, respects .gitignore)
// and falls back to a bounded directory walk for non-git folders.
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target']);
const MAX_FILES = 50_000;
const TTL = 15_000;
const cache = new Map<string, { at: number; entries: Promise<string[]> }>();

function gitFiles(root: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout.split('\0').filter(Boolean).slice(0, MAX_FILES)));
  });
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [''];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!IGNORED.has(entry.name)) stack.push(rel); }
      else if (entry.isFile()) files.push(rel);
    }
  }
  return files;
}

/** Files plus their parent directories (directories end with `/`). */
async function index(root: string): Promise<string[]> {
  const files = await gitFiles(root).catch(() => walkFiles(root));
  const dirs = new Set<string>();
  for (const file of files) {
    for (let i = file.indexOf('/'); i >= 0; i = file.indexOf('/', i + 1)) dirs.add(file.slice(0, i + 1));
  }
  return [...dirs, ...files];
}

export function invalidateFileCache(root: string): void { cache.delete(root); }

function entries(root: string): Promise<string[]> {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < TTL) return hit.entries;
  const next = { at: Date.now(), entries: index(root) };
  next.entries.catch(() => cache.delete(root));
  cache.set(root, next);
  return next.entries;
}

function score(entry: string, query: string): number | null {
  const target = entry.toLowerCase();
  const trimmed = target.endsWith('/') ? target.slice(0, -1) : target;
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  let value: number;
  if (base === query) value = 1000;
  else if (base.startsWith(query)) value = 800;
  else if (base.includes(query)) value = 600;
  else if (target.startsWith(query)) value = 500;
  else if (target.includes(query)) value = 400 - target.indexOf(query);
  else {
    // Fuzzy subsequence match, rewarding consecutive characters.
    let pos = -1, streak = 0;
    value = 0;
    for (const char of query) {
      const next = target.indexOf(char, pos + 1);
      if (next < 0) return null;
      streak = next === pos + 1 ? streak + 1 : 0;
      value += 1 + streak * 3;
      pos = next;
    }
  }
  return value - entry.length * 0.5;
}

export async function searchFiles(root: string, query: string, limit = 50): Promise<{ path: string; dir: boolean; uri: string }[]> {
  const all = await entries(root);
  const q = query.trim().replace(/\\/g, '/').toLowerCase();
  let picked: string[];
  if (!q) {
    // Nothing typed yet: show the top level, directories first.
    picked = all.filter(e => !e.slice(0, -1).includes('/')).sort((a, b) => Number(b.endsWith('/')) - Number(a.endsWith('/')) || a.localeCompare(b));
  } else {
    picked = all.filter(e => e.toLowerCase() !== q).map(e => ({ e, s: score(e, q) })).filter((r): r is { e: string; s: number } => r.s !== null).sort((a, b) => b.s - a.s).map(r => r.e);
  }
  return picked.slice(0, limit).map(p => ({ path: p, dir: p.endsWith('/'), uri: pathToFileURL(path.join(root, p)).href }));
}

/** Validate lexical containment and existing ancestors, including symbolic links. */
export function resolveProjectPath(root: string, file: string): string {
  if (file.includes('\0')) throw new Error('Invalid project path');
  const base = fs.realpathSync(root);
  const target = path.resolve(base, file.replace(/\\/g, '/'));
  const inside = (candidate: string) => {
    const rel = path.relative(base, candidate);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Path outside project');
  };
  inside(target);
  let ancestor = target;
  while (true) {
    try { fs.lstatSync(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  inside(fs.realpathSync(ancestor));
  return target;
}