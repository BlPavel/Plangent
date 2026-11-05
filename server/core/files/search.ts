import type { SearchOptions as importSearchOptions } from '@contracts';
import type { SearchEvent } from '@contracts';
export type { SearchEvent } from '@contracts';
import { grep } from '../../infrastructure/git/grep';
import { isBinary, readBytes } from './files';
import { DomainError } from '../../models/domain-error';
import { isRepository, listFiles } from '../../infrastructure/git/read';

export interface SearchOptions extends importSearchOptions { signal?: AbortSignal }

export const MAX_MATCHES = 2000;
export const MAX_SEARCH_FILES = 200;

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function searchPattern(options: SearchOptions): RegExp {
  if (!options.query || options.query.length > 4096 || /[\r\n\0]/.test(options.query))
    throw new DomainError('Search query must be one non-empty line (at most 4096 characters)');
  try {
    const pattern = options.regex ? options.query : escapeRegex(options.query);
    return new RegExp(options.wholeWord ? '\\b(?:' + pattern + ')\\b' : pattern, options.caseSensitive ? '' : 'i');
  } catch { throw new DomainError('Invalid regular expression'); }
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
  if (value.length > 1024 || value.includes('\0')) throw new DomainError('Invalid file mask');
  const patterns = value.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ base: !s.includes('/'), re: globRegex(s) }));
  return file => !patterns.length || patterns.some(p => p.re.test(p.base ? file.slice(file.lastIndexOf('/') + 1) : file));
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
      if (error instanceof DomainError && error.status === 404) return null;
      // An unsafe tracked symlink must not escape project containment.
      if (error instanceof DomainError && error.status === 400) return null;
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
