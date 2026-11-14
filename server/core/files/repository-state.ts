import type { GitChange } from '@contracts';
import fs from 'node:fs';
import { changedFiles, listFiles } from '../../infrastructure/git/read';

// Snapshots of `git ls-files` and `git status` shared by the Code screen's reads (tree levels,
// changes, stats, search). Only roots whose whole working tree is watched keep them between
// requests: any file system event drops the snapshot, so a read never sees a state older than
// the last change the watcher reported. Elsewhere every read asks Git again.
interface Snapshot { files?: Promise<string[]>; dirs?: Promise<Set<string>>; changes?: Promise<GitChange[]> }
const snapshots = new Map<string, Snapshot>();
const watched = new Map<string, number>();

// The watcher keys roots by their real path; requests may name the same folder differently.
function key(root: string): string {
  try { return fs.realpathSync(root); } catch { return root; }
}

/** Called by the recursive watcher of a root (a real path); the returned function releases it. */
export function watchRepositoryState(root: string): () => void {
  watched.set(root, (watched.get(root) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (watched.get(root) ?? 1) - 1;
    if (count > 0) watched.set(root, count);
    else { watched.delete(root); snapshots.delete(root); }
  };
}

export function invalidateRepositoryState(root: string): void { snapshots.delete(root); }

function cached<K extends keyof Snapshot>(root: string, part: K, load: () => NonNullable<Snapshot[K]>): NonNullable<Snapshot[K]> {
  if (!watched.size) return load();
  const id = key(root);
  if (!watched.has(id)) return load();
  let snapshot = snapshots.get(id);
  if (!snapshot) snapshots.set(id, snapshot = {});
  const hit = snapshot[part];
  if (hit) return hit as NonNullable<Snapshot[K]>;
  const value = load();
  const current = snapshot;
  current[part] = value;
  // A failed read is not remembered.
  (value as Promise<unknown>).catch(() => { if (current[part] === value) delete current[part]; });
  return value;
}

/** Tracked and untracked files that are not ignored, as `listFiles(root)` returns them. */
export function visibleFiles(root: string): Promise<string[]> {
  return cached(root, 'files', () => listFiles(root));
}

/** Every directory that contains a visible file. */
export function visibleDirectories(root: string): Promise<Set<string>> {
  return cached(root, 'dirs', async () => {
    const dirs = new Set<string>();
    for (const file of await visibleFiles(root)) {
      for (let i = file.indexOf('/'); i >= 0; i = file.indexOf('/', i + 1)) dirs.add(file.slice(0, i));
    }
    return dirs;
  });
}

/** Working tree changes, as `changedFiles(root)` returns them. */
export function viewedChanges(root: string): Promise<GitChange[]> {
  return cached(root, 'changes', () => changedFiles(root));
}
