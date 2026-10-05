import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { invalidateFileCache } from '../projects/files';

export interface CodeChangeEvent { type: 'code:changed'; projectId: string }
interface Subscription { projectId: string; notify: (event: CodeChangeEvent) => void }
interface Entry { watchers: fs.FSWatcher[]; subscriptions: Set<Subscription>; timer?: NodeJS.Timeout }
const entries = new Map<string, Entry>();
const excluded = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target']);

export function relevantChange(file: string): boolean {
  const parts = file.replace(/\\/g, '/').split('/');
  if (parts.some(p => excluded.has(p))) return false;
  const git = parts.indexOf('.git');
  return git < 0 || /^(HEAD|index|packed-refs|refs(?:\/|$))/.test(parts.slice(git + 1).join('/'));
}

/** One native recursive watcher per root on Windows/macOS, only Git metadata on Linux. */
export function subscribeCode(root: string, projectId: string, notify: Subscription['notify']): () => void {
  root = fs.realpathSync(root);
  let entry = entries.get(root);
  if (!entry) {
    entry = { watchers: [], subscriptions: new Set() };
    const current = entry;
    const changed = () => {
      if (current.timer) clearTimeout(current.timer);
      current.timer = setTimeout(() => {
        invalidateFileCache(root);
        for (const sub of current.subscriptions) sub.notify({ type: 'code:changed', projectId: sub.projectId });
      }, 500);
    };
    const add = (directory: string, recursive: boolean, filter: (file: string) => boolean) => {
      const watcher = fs.watch(directory, { recursive }, (_event, file) => {
        if (!file || filter(file.toString())) changed();
      });
      watcher.on('error', changed);
      current.watchers.push(watcher);
    };
    try {
      if (process.platform === 'win32' || process.platform === 'darwin') add(root, true, relevantChange);
      // Worktrees store HEAD/index outside the project. Watching the containing directory survives atomic replacement.
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: root, windowsHide: true, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (fs.realpathSync(top) !== root) throw new Error('Project is not a repository root');
      const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: root, windowsHide: true, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (process.platform === 'linux' || !gitDir.startsWith(root + path.sep)) {
        add(gitDir, false, file => file === 'HEAD' || file === 'index' || file === 'packed-refs');
      }
    } catch (error) {
      // Non-Git Linux projects use manual refresh. Windows/macOS still watch their working files.
      if (!current.watchers.length && process.platform !== 'linux') throw error;
    }
    entries.set(root, entry);
  }
  const subscription = { projectId, notify };
  entry.subscriptions.add(subscription);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    entry!.subscriptions.delete(subscription);
    if (entry!.subscriptions.size) return;
    if (entry!.timer) clearTimeout(entry!.timer);
    for (const watcher of entry!.watchers) watcher.close();
    entries.delete(root);
  };
}
