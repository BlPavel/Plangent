import { runGit } from '../code/git-write';
import { branches, diffFile, oldFile, treeChanges, type GitBranch, type LineStat } from '../code/git';

const SHA = /^[a-f0-9]{40,64}$/;
const sha = (value: string) => SHA.test(value) ? value : (() => { throw new Error('Invalid commit'); })();

export interface ReviewFile {
  path: string;
  old_path?: string;
  status: string;
  added: number;
  deleted: number;
  binary: boolean;
  /** Blob pair of the file in this range; a viewed mark is valid only while it is unchanged. */
  sig: string;
}
export interface ReviewCommit { sha: string; subject: string; author: string; date: string }

/** Only refs that exist in the repository may be reviewed; the name never reaches git as an option. */
export async function resolveRef(root: string, ref: unknown): Promise<GitBranch> {
  const found = typeof ref === 'string' ? (await branches(root)).find(b => b.ref === ref) : undefined;
  if (!found) throw new Error('Ветка не найдена. Обновите список веток.');
  return found;
}
export async function commitOf(root: string, ref: string): Promise<string> {
  return (await runGit(root, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'])).trim();
}
export async function mergeBase(root: string, base: string, head: string): Promise<string> {
  return (await runGit(root, ['merge-base', sha(base), sha(head)])).trim();
}
export function isAncestor(root: string, ancestor: string, head: string): Promise<boolean> {
  return runGit(root, ['merge-base', '--is-ancestor', sha(ancestor), sha(head)]).then(() => true, () => false);
}
/** `:old new oldsha newsha status\0path[\0path]` records of a raw diff. */
export function parseRaw(output: string): Map<string, string> {
  const fields = output.split('\0'), result = new Map<string, string>();
  for (let i = 0; i < fields.length; i++) {
    const match = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(fields[i]);
    if (!match) continue;
    const renamed = match[3] === 'R' || match[3] === 'C';
    if (renamed) i++;
    result.set(fields[++i], match[1] + ':' + match[2]);
  }
  return result;
}
export async function rangeFiles(root: string, from: string, to: string): Promise<ReviewFile[]> {
  const [{ changes, stats }, raw] = await Promise.all([
    treeChanges(root, sha(from), sha(to)),
    runGit(root, ['diff', '--raw', '-z', '--no-abbrev', '--no-ext-diff', '--no-textconv', '-M', sha(from), sha(to), '--']),
  ]);
  const sigs = parseRaw(raw);
  return changes.map(change => {
    const stat: LineStat = stats[change.path] ?? { added: 0, deleted: 0 };
    return { path: change.path, ...(change.originalPath ? { old_path: change.originalPath } : {}), status: change.status,
      added: stat.added, deleted: stat.deleted, binary: !!stat.binary, sig: sigs.get(change.path) ?? '' };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
export async function rangeCommits(root: string, from: string, to: string, limit = 200): Promise<ReviewCommit[]> {
  const out = await runGit(root, ['log', '-z', '--max-count=' + limit, '--format=%H%x1f%an%x1f%aI%x1f%s', sha(from) + '..' + sha(to), '--']);
  return out.split('\0').filter(Boolean).map(record => {
    const [id, author, date, subject] = record.split('\x1f');
    return { sha: id.trim(), author, date, subject };
  });
}
export async function rangeCount(root: string, from: string, to: string): Promise<number> {
  return Number((await runGit(root, ['rev-list', '--count', sha(from) + '..' + sha(to), '--'])).trim());
}
export const fileDiff = (root: string, from: string, to: string, file: ReviewFile) =>
  diffFile(root, file.path, { base: sha(from), end: sha(to), originalPath: file.old_path });
export const fileAt = (root: string, commit: string, file: string) => oldFile(root, file, sha(commit));
