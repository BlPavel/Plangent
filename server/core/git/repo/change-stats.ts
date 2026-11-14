import { trackedStats, type LineStat } from '../../../infrastructure/git/read';
import { readBytes, isBinary, viewedChanges } from '../../files';

/** Per-file `+/−` of everything that differs from HEAD; untracked text files count as fully added. */
export async function changeStats(root: string): Promise<Record<string, LineStat>> {
  const [stats, changes] = await Promise.all([trackedStats(root), viewedChanges(root)]);
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
