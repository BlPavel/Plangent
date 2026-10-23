import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publicRemoteUrl } from '../projects/remote-url';
import { resolveProjectPath } from '../projects/files';

// Private runner. No shell, optional index refresh, external diff, or textconv.
function run(root: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-optional-locks', '-c', 'core.quotepath=off', '--literal-pathspecs', ...args], {
      cwd: root, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', ...env },
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

/** Resolve a remote branch to the common ancestor with the selected local commit. */
export async function remoteMergeBase(root: string, ref: string, end = 'HEAD'): Promise<string> {
  const full = ref.startsWith('refs/remotes/') ? ref : 'refs/remotes/' + ref;
  if (full.includes('\0') || full.endsWith('/HEAD')) throw new Error('Invalid remote ref');
  await run(root, ['check-ref-format', full]);
  const remote = (await run(root, ['rev-parse', '--verify', '--end-of-options', full + '^{commit}'])).trim();
  if (!/^(?:HEAD|[a-fA-F0-9]{40,64})$/.test(end)) throw new Error('Invalid comparison end');
  return (await run(root, ['merge-base', remote, end])).trim();
}
const remoteBase = (base: string) => base.startsWith('origin/') || base.startsWith('refs/remotes/');
export interface DiffOptions { base?: string; end?: string; ignoreWhitespace?: boolean; originalPath?: string }

export async function diffFile(root: string, file: string, options: DiffOptions = {}): Promise<string> {
  const rel = filePath(root, file);
  const paths = options.originalPath ? [filePath(root, options.originalPath), rel] : [rel];
  const flags = ['--no-ext-diff', '--no-textconv', '-M', ...(options.ignoreWhitespace ? ['-w', '--ignore-cr-at-eol'] : [])];
  const inputBase = options.base ?? 'HEAD';
  const end = options.end ?? (remoteBase(inputBase) ? 'HEAD' : undefined);
  const base = await revision(root, remoteBase(inputBase) ? await remoteMergeBase(root, inputBase, end) : inputBase);
  if (end) return run(root, ['diff', ...flags, base, await revision(root, end), '--', ...paths]);
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
  const from = await revision(root, remoteBase(base) ? await remoteMergeBase(root, base, end) : base);
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

export interface GitBranch { name: string; ref: string; remote: boolean }
export async function branches(root: string): Promise<GitBranch[]> {
  const output = await run(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/origin/']);
  return output.split('\n').map(ref => ref.trim()).filter(ref => ref && ref !== 'refs/remotes/origin/HEAD').map(ref => ({
    ref, name: ref.startsWith('refs/heads/') ? ref.slice(11) : ref.slice(13), remote: ref.startsWith('refs/remotes/'),
  }));
}
export async function originUrl(root: string): Promise<string | null> {
  if (!await isRepository(root)) return null;
  return run(root, ['remote', 'get-url', 'origin']).then(value => value.trim()).catch(() => null);
}
export async function trackingInfo(root: string) {
  const info = await repositoryInfo(root);
  if (!info) return null;
  const upstream = await run(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then(value => value.trim()).catch(() => null);
  const counts = upstream ? (await run(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}', '--'])).trim().split(/\s+/).map(Number) : [0, 0];
  const detachedBranches = info.head ? (await run(root, ['for-each-ref', '--contains', info.head, '--format=%(refname:short)', 'refs/heads/'])).split('\n').map(value => value.trim()).filter(Boolean) : [];
  const origin = await originUrl(root);
  return { ...info, upstream, ahead: counts[0], behind: counts[1], origin: origin ? publicRemoteUrl(origin) : null, detachedBranches };
}
/** A merge, rebase, cherry-pick or revert the developer started and has not finished yet. */
export interface GitOperationState {
  kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert';
  /** The same while one operation goes on: a rebase keeps it across all its stops. */
  id: string;
  /** The branch being rebased, or the branch HEAD is on. */
  branch: string | null;
  /** rebase: the commit being replayed; cherry-pick/revert: the picked commit; merge: the merged-in commit. */
  commit: { sha: string; subject: string; name: string | null } | null;
  /** rebase: what the branch is replayed onto. */
  onto: { sha: string; name: string | null } | null;
  /** rebase: which commit of how many. */
  step: { done: number; total: number } | null;
}
async function gitFile(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').then(text => text.trim(), () => null);
}
async function refName(root: string, sha: string): Promise<string | null> {
  const names = (await run(root, ['for-each-ref', '--points-at', sha, '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/']).catch(() => ''))
    .split('\n').map(name => name.trim()).filter(name => name && !name.endsWith('/HEAD'));
  return names.find(name => name.startsWith('origin/')) ?? names[0] ?? null;
}
async function commitInfo(root: string, ref: string) {
  const sha = await run(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']).then(s => s.trim(), () => '');
  if (!sha) return null;
  const subject = (await run(root, ['log', '-1', '--format=%s', sha, '--']).catch(() => '')).trim();
  return { sha, subject, name: await refName(root, sha) };
}
/** Read from the files Git keeps while an operation is in progress; null when there is none. */
export async function gitOperation(root: string): Promise<GitOperationState | null> {
  if (!await isRepository(root)) return null;
  const names = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'];
  const paths = (await run(root, ['rev-parse', '--path-format=absolute', ...names.flatMap(name => ['--git-path', name])])).split('\n').map(line => line.trim());
  const at = Object.fromEntries(names.map((name, i) => [name, paths[i]]));
  const exists = (file: string) => fs.stat(file).then(() => true, () => false);
  const branch = await run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(s => s.trim(), () => null);
  for (const dir of [at['rebase-merge'], at['rebase-apply']]) {
    if (!await exists(dir)) continue;
    // `git am` uses the same folder; it is not a rebase.
    if (await exists(path.join(dir, 'applying'))) return null;
    const merge = dir === at['rebase-merge'];
    const [head, onto, origHead, done, total] = await Promise.all(['head-name', 'onto', 'orig-head', merge ? 'msgnum' : 'next', merge ? 'end' : 'last']
      .map(name => gitFile(path.join(dir, name))));
    const ontoSha = onto ?? '';
    return {
      kind: 'rebase', id: 'rebase:' + (origHead ?? '') + ':' + ontoSha,
      branch: head ? head.replace(/^refs\/heads\//, '') : null,
      commit: await commitInfo(root, 'REBASE_HEAD'),
      onto: ontoSha ? { sha: ontoSha, name: await refName(root, ontoSha) } : null,
      step: done && total && Number(total) > 0 ? { done: Number(done), total: Number(total) } : null,
    };
  }
  if (await exists(at.MERGE_HEAD)) {
    const commit = await commitInfo(root, 'MERGE_HEAD');
    const head = await run(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(s => s.trim(), () => '');
    return { kind: 'merge', id: 'merge:' + head + ':' + (commit?.sha ?? ''), branch, commit, onto: null, step: null };
  }
  for (const [kind, file] of [['cherry-pick', 'CHERRY_PICK_HEAD'], ['revert', 'REVERT_HEAD']] as const) {
    if (!await exists(at[file])) continue;
    const commit = await commitInfo(root, file);
    // A picked series keeps its starting point in the sequencer folder.
    const series = await gitFile(path.join(at.sequencer, 'head'));
    return { kind, id: kind + ':' + (series ?? commit?.sha ?? ''), branch, commit, onto: null, step: null };
  }
  return null;
}
/** Unmerged files with their two-letter code (UU both modified, DU deleted by us, …). */
export async function conflictedFiles(root: string): Promise<{ path: string; code: string }[]> {
  return (await changedFiles(root)).filter(change => change.status === 'U').map(change => ({ path: change.path, code: change.indexStatus + change.worktreeStatus }));
}
export async function stagedDiff(root: string): Promise<string> {
  return run(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--']);
}

export async function recentCoauthors(root: string): Promise<{ name: string; email: string }[]> {
  const output = await run(root, ['log', '-100', '--format=%aN%x09%aE%n%(trailers:key=Co-authored-by,valueonly)', '--']).catch(() => '');
  const authors = output.split('\n').flatMap(line => {
    const trailer = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(line.trim());
    const author = line.split('\t');
    return trailer ? [{ name: trailer[1].trim(), email: trailer[2] }] : author.length === 2 ? [{ name: author[0], email: author[1] }] : [];
  });
  return [...new Map(authors.map(author => [author.email, author])).values()];
}

/** True when any commit created after the workflow base is reachable from fetched origin refs. */
export async function publishedWorkflowCommits(root: string, base: string, head: string): Promise<boolean> {
  if (!/^[a-f0-9]{40,64}$/.test(base) || !/^[a-f0-9]{40,64}$/.test(head)) throw new Error('Invalid commit');
  const range = base + '..' + head;
  const all = Number((await run(root, ['rev-list', '--count', range, '--'])).trim());
  const privateCount = Number((await run(root, ['rev-list', '--count', range, '--not', '--remotes=origin', '--'])).trim());
  return privateCount < all;
}
