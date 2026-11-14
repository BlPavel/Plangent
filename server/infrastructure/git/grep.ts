import { spawn } from 'node:child_process';
import { DomainError } from '../../models/domain-error';
import type { SearchOptions, SearchEvent } from '@contracts';
/** Git stdout is consumed with backpressure; the process is killed on disconnect or early exit. */
export async function* grep(root: string, paths: string[], options: SearchOptions & { signal?: AbortSignal }): AsyncGenerator<Extract<SearchEvent, { type: 'match' }>> {
  options.signal?.throwIfAborted();
  const child = spawn('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotepath=off',
    'grep', '--untracked', '--exclude-standard', '-I', '-n', '-z',
    options.regex ? '-P' : '-F', ...(options.caseSensitive ? [] : ['-i']),
    ...(options.wholeWord ? ['-w'] : []), '-e', options.query, '--', ...paths],
    { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', b => { if (stderr.length < 8192) stderr += b.toString(); });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  // Attach a rejection handler immediately, including when the consumer stops early.
  void finished.catch(() => {});
  const cancel = () => child.kill();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 30_000);
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of child.stdout) {
      options.signal?.throwIfAborted();
      pending = Buffer.concat([pending, chunk as Buffer]);
      while (true) {
        const a = pending.indexOf(0);
        const b = a < 0 ? -1 : pending.indexOf(0, a + 1);
        const end = b < 0 ? -1 : pending.indexOf(10, b + 1);
        if (end < 0) break;
        options.signal?.throwIfAborted();
        yield { type: 'match', path: pending.subarray(0, a).toString('utf8'),
          line: Number(pending.subarray(a + 1, b).toString()), text: pending.subarray(b + 1, end).toString('utf8').replace(/\r$/, '') };
        pending = pending.subarray(end + 1);
      }
      // Candidates were bounded before spawning; also bound unexpected output after a concurrent file change.
      if (pending.length > 2 * 1024 * 1024) throw new DomainError('Search output line is too large');
    }
    options.signal?.throwIfAborted();
    const code = await finished;
    if (code !== 0 && code !== 1) throw new DomainError(stderr.trim() || 'Git search failed');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    child.kill();
    child.stdout.destroy();
    await finished.catch(() => {});
  }
}

