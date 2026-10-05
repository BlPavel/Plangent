import { spawn } from 'node:child_process';
import { CodeError, isBinary, readBytes } from './files';
import { isRepository, listFiles } from './git';

export interface SearchOptions {
  query: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; mask?: string;
  signal?: AbortSignal;
}
export type SearchEvent =
  | { type: 'match'; path: string; line: number; text: string }
  | { type: 'done'; matches: number; files: number; truncated: boolean };
export const MAX_MATCHES = 2000;
export const MAX_SEARCH_FILES = 200;

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function searchPattern(options: SearchOptions): RegExp {
  if (!options.query || options.query.length > 4096 || /[\r\n\0]/.test(options.query))
    throw new CodeError('Search query must be one non-empty line (at most 4096 characters)');
  try {
    const pattern = options.regex ? options.query : escapeRegex(options.query);
    return new RegExp(options.wholeWord ? '\\b(?:' + pattern + ')\\b' : pattern, options.caseSensitive ? '' : 'i');
  } catch { throw new CodeError('Invalid regular expression'); }
}

function globRegex(mask: string): RegExp {
  let pattern = '';
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === '*') {
      if (mask[i + 1] === '*') {
        i++;
        if (mask[i + 1] === '/') { i++; pattern += '(?:.*/)?'; }
        else pattern += '.*';
      } else pattern += '[^/]*';
    } else if (mask[i] === '?') pattern += '[^/]';
    else pattern += escapeRegex(mask[i]);
  }
  return new RegExp('^' + pattern + '$');
}
function masks(value = ''): (file: string) => boolean {
  if (value.length > 1024 || value.includes('\0')) throw new CodeError('Invalid file mask');
  const patterns = value.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ base: !s.includes('/'), re: globRegex(s) }));
  return file => !patterns.length || patterns.some(p => p.re.test(p.base ? file.slice(file.lastIndexOf('/') + 1) : file));
}

/** Git stdout is consumed with backpressure; the process is killed on disconnect or early exit. */
async function* grep(root: string, paths: string[], options: SearchOptions): AsyncGenerator<Extract<SearchEvent, { type: 'match' }>> {
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
      if (pending.length > 2 * 1024 * 1024) throw new CodeError('Search output line is too large');
    }
    options.signal?.throwIfAborted();
    const code = await finished;
    if (code !== 0 && code !== 1) throw new CodeError(stderr.trim() || 'Git search failed');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    child.kill();
    child.stdout.destroy();
    await finished.catch(() => {});
  }
}

export async function* searchCode(root: string, options: SearchOptions): AsyncGenerator<SearchEvent> {
  const pattern = searchPattern(options);
  const accept = masks(options.mask);
  options.signal?.throwIfAborted();
  const repository = await isRepository(root);
  const paths = (await listFiles(root)).filter(accept);
  let count = 0;
  const foundFiles = new Set<string>();
  const acceptMatch = (match: Extract<SearchEvent, { type: 'match' }>) => {
    if (count >= MAX_MATCHES || (!foundFiles.has(match.path) && foundFiles.size >= MAX_SEARCH_FILES)) return false;
    count++; foundFiles.add(match.path); return true;
  };
  let batch: string[] = [], batchLength = 0;
  async function* execute(): AsyncGenerator<Extract<SearchEvent, { type: 'match' }>> {
    if (batch.length) yield* grep(root, batch, options);
    batch = []; batchLength = 0;
  }
  for (const file of paths) {
    options.signal?.throwIfAborted();
    const data = await readBytes(root, file).catch(error => {
      if (error instanceof CodeError && error.status === 404) return null;
      // An unsafe tracked symlink must not escape project containment.
      if (error instanceof CodeError && error.status === 400) return null;
      throw error;
    });
    if (!data?.bytes || isBinary(data.bytes)) continue;
    if (repository) {
      if (batchLength + file.length > 20_000 || batch.length >= 100) {
        for await (const match of execute()) {
          if (!acceptMatch(match)) { yield { type: 'done', matches: count, files: foundFiles.size, truncated: true }; return; }
          yield match;
        }
      }
      batch.push(file); batchLength += file.length + 1;
    } else {
      let line = 0;
      for (const text of data.bytes.toString('utf8').split(/\r?\n/)) {
        options.signal?.throwIfAborted();
        line++;
        if (!pattern.test(text)) continue;
        const match = { type: 'match' as const, path: file, line, text };
        if (!acceptMatch(match)) { yield { type: 'done', matches: count, files: foundFiles.size, truncated: true }; return; }
        yield match;
      }
    }
  }
  if (repository) for await (const match of execute()) {
    if (!acceptMatch(match)) { yield { type: 'done', matches: count, files: foundFiles.size, truncated: true }; return; }
    yield match;
  }
  yield { type: 'done', matches: count, files: foundFiles.size, truncated: false };
}
