import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectPath } from '../projects/files';

// Private runner. No shell, optional index refresh, external diff, or textconv.
function run(root: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-optional-locks', '-c', 'core.quotepath=off', '--literal-pathspecs', ...args], {
      cwd: root, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_PAGER: 'cat', ...env },
    }, (error, stdout) => {
      if (error) { Object.assign(error, { stdout }); reject(error); }
      else resolve(stdout);
    });
  });
}

/** Local branch names, including Unicode names; never contacts remotes. */
export async function localBranches(root: string): Promise<string[]> {
  return (await run(root, ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/']))
    .split('\n').map(name => name.trim()).filter(Boolean);
}

/** Resolve a local branch via its exact name, never by interpreting revision syntax. */
export async function localBranchHead(root: string, branch: string): Promise<string | null> {
  const refs = await run(root, ['for-each-ref', '--format=%(refname:strip=2)%09%(objectname)', 'refs/heads/']);
  return refs.split('\n').map(record => record.trim().split('\t')).find(([name]) => name === branch)?.[1] ?? null;
}

export async function reviewCommitCount(root: string, start: string, end: string): Promise<number> {
  if (!/^[a-f0-9]{40,64}$/.test(start) || !/^[a-f0-9]{40,64}$/.test(end)) throw new Error('Invalid commit');
  return Number((await run(root, ['rev-list', '--count', start + '..' + end, '--'])).trim());
}

export interface RepositoryInfo { branch: string | null; head: string | null; message: string | null; detached: boolean }

/** Do not treat a non-repository project nested in another repo as a repository. */
export async function isRepository(root: string): Promise<boolean> {
  const top = await run(root, ['rev-parse', '--show-toplevel']).catch(() => null);
  if (!top) return false;
  return await fs.realpath(root) === await fs.realpath(top.trim());
}

export async function repositoryInfo(root: string): Promise<RepositoryInfo | null> {
  if (!await isRepository(root)) return null;
  const branch = await run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(s => s.trim()).catch(() => null);
  const head = await run(root, ['rev-parse', '--verify', 'HEAD']).then(s => s.trim()).catch(() => null);
  const message = head ? (await run(root, ['log', '-1', '--format=%B', head, '--'])).trimEnd() : null;
  return { branch, head, message, detached: branch === null && head !== null };
}

function filePath(root: string, file: string): string {
  const full = resolveProjectPath(root, file);
  const rel = path.relative(resolveProjectPath(root, ''), full).replace(/\\/g, '/');
  if (!rel || rel.split('/').some(part => part.toLowerCase() === '.git')) throw new Error('Invalid git file path');
  return rel;
}

async function walk(root: string, includeIgnored: boolean): Promise<string[]> {
  const files: string[] = [];
  const excluded = new Set(['node_modules', 'dist', 'build', 'coverage', '.venv']);
  async function visit(dir: string): Promise<void> {
    for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
      if (entry.name.toLowerCase() === '.git') continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory() && (includeIgnored || !excluded.has(entry.name))) await visit(rel);
      else if (entry.isFile()) files.push(rel);
    }
  }
  await visit('');
  return files;
}

export async function listFiles(root: string, includeIgnored = false): Promise<string[]> {
  if (!await isRepository(root)) return walk(root, includeIgnored);
  const files = (await run(root, ['ls-files', '-co', '--exclude-standard', '-z', '--'])).split('\0').filter(Boolean);
  if (includeIgnored) files.push(...await walk(root, true));
  return [...new Set(files)].sort();
}

export interface GitChange {
  path: string; originalPath?: string; status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';
  indexStatus: string; worktreeStatus: string;
}

export function parseStatus(output: string): GitChange[] {
  const records = output.split('\0');
  const changes: GitChange[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record[0] === '!' || record[0] === '#') continue;
    if (record.startsWith('? ')) {
      changes.push({ path: record.slice(2), status: '?', indexStatus: '?', worktreeStatus: '?' });
      continue;
    }
    const fields = record[0] === '1' ? 8 : record[0] === '2' ? 9 : record[0] === 'u' ? 10 : 0;
    if (!fields) throw new Error('Invalid git status record');
    let offset = 0;
    for (let n = 0; n < fields; n++) offset = record.indexOf(' ', offset) + 1;
    const xy = record.split(' ', 2)[1];
    const status = record[0] === 'u' ? 'U' : xy.includes('R') ? 'R' : xy.includes('C') ? 'C' : xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : 'M';
    changes.push({ path: record.slice(offset), status, indexStatus: xy[0], worktreeStatus: xy[1],
      ...(record[0] === '2' ? { originalPath: records[++i] } : {}) });
  }
  return changes;
}

export async function changedFiles(root: string): Promise<GitChange[]> {
  if (!await isRepository(root)) return [];
  return parseStatus(await run(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--']));
}

// Git knows the empty tree in every repository, even when it is not stored.
const emptyTrees: Record<string, string> = {
  sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321',
};

// Resolve safe refs to tree IDs; disallow options and arbitrary revision expressions.
async function revision(root: string, base: string): Promise<string> {
  if (!/^(?:HEAD|[a-fA-F0-9]{4,64}|[a-zA-Z0-9_][a-zA-Z0-9_./-]*)$/.test(base) || base.includes('..')) throw new Error('Invalid git base');
  try { return (await run(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{tree}`])).trim(); }
  catch (error) {
    // A branch without commits yet: everything in the worktree is new, so HEAD is the empty tree.
    if (base !== 'HEAD' || await run(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true, () => false)) throw error;
    const format = (await run(root, ['rev-parse', '--show-object-format']).catch(() => 'sha1')).trim();
    return emptyTrees[format] ?? emptyTrees.sha1;
  }
}

export async function oldFile(root: string, file: string, base = 'HEAD'): Promise<string> {
  const rel = filePath(root, file);
  return run(root, ['show', `${await revision(root, base)}:${rel}`, '--']);
}

export interface DiffOptions { base?: string; end?: string; ignoreWhitespace?: boolean; originalPath?: string }

export async function diffFile(root: string, file: string, options: DiffOptions = {}): Promise<string> {
  const rel = filePath(root, file);
  const paths = options.originalPath ? [filePath(root, options.originalPath), rel] : [rel];
  const flags = ['--no-ext-diff', '--no-textconv', '-M', ...(options.ignoreWhitespace ? ['-w', '--ignore-cr-at-eol'] : [])];
  const base = await revision(root, options.base ?? 'HEAD');
  if (options.end) return run(root, ['diff', ...flags, base, await revision(root, options.end), '--', ...paths]);
  const present = await run(root, ['ls-tree', '-z', base, '--', rel]);
  if (!present && !options.originalPath && await fs.stat(resolveProjectPath(root, rel)).then(s => s.isFile()).catch(() => false)) {
    try { return await run(root, ['diff', '--no-index', ...flags, '--', '/dev/null', rel]); }
    catch (error) {
      const failure = error as Error & { code?: number; stdout?: string };
      if (failure.code === 1 && typeof failure.stdout === 'string') return failure.stdout;
      throw error;
    }
  }
  return run(root, ['diff', ...flags, base, '--', ...paths]);
}

/** Writes unreachable objects only. Never touches refs or the developer's index. */
export async function snapshot(root: string): Promise<string | null> {
  if (!await isRepository(root)) return null;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-git-index-'));
  const env = { GIT_INDEX_FILE: path.join(temp, 'index') };
  try {
    // Seed from the actual index so tracked files remain tracked even if now ignored.
    const index = (await run(root, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
    await fs.copyFile(index, env.GIT_INDEX_FILE).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    await run(root, ['add', '-A', '--', '.'], env);
    return (await run(root, ['write-tree'], env)).trim();
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
export interface LineStat { added: number; deleted: number; binary?: boolean }

/** `--numstat -z` of the working tree against HEAD (the empty tree before the first commit), keyed by the new path. */
export async function trackedStats(root: string): Promise<Record<string, LineStat>> {
  if (!await isRepository(root)) return {};
  let output: string;
  try { output = await run(root, ['diff', '--no-ext-diff', '--no-textconv', '-M', '--numstat', '-z', await revision(root, 'HEAD'), '--']); }
  catch { return {}; }
  return parseNumstat(output);
}

function parseNumstat(output: string): Record<string, LineStat> {
  const fields = output.split('\0');
  const result: Record<string, LineStat> = {};
  for (let i = 0; i < fields.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[i]);
    if (!match) continue;
    // Renames are "added\tdeleted\t" followed by the old and the new path as separate records.
    const file = match[3] === '' ? (i += 2, fields[i]) : match[3];
    result[file] = match[1] === '-' ? { added: 0, deleted: 0, binary: true } : { added: Number(match[1]), deleted: Number(match[2]) };
  }
  return result;
}

const nameStatus: Record<string, GitChange['status']> = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', T: 'M', U: 'U' };

/** Files that differ between two trees/commits with their line counts; renames are detected. Untracked files are not part of a tree diff. */
export async function treeChanges(root: string, base: string, end: string): Promise<{ changes: GitChange[]; stats: Record<string, LineStat> }> {
  if (!await isRepository(root)) return { changes: [], stats: {} };
  const from = await revision(root, base);
  const to = await revision(root, end);
  const flags = ['--no-ext-diff', '--no-textconv', '-M'];
  const [names, numbers] = await Promise.all([
    run(root, ['diff', ...flags, '--name-status', '-z', from, to, '--']),
    run(root, ['diff', ...flags, '--numstat', '-z', from, to, '--']),
  ]);
  const records = names.split('\0');
  const changes: GitChange[] = [];
  for (let i = 0; i < records.length; i++) {
    const code = records[i];
    if (!code) continue;
    const status = nameStatus[code[0]] ?? 'M';
    if (status === 'R' || status === 'C') {
      const originalPath = records[++i];
      changes.push({ path: records[++i], originalPath, status, indexStatus: code[0], worktreeStatus: ' ' });
    } else changes.push({ path: records[++i], status, indexStatus: code[0], worktreeStatus: ' ' });
  }
  return { changes, stats: parseNumstat(numbers) };
}
