import type { SearchOptions as importSearchOptions } from '@contracts';
import type { SearchEvent } from '@contracts';
export type { SearchEvent } from '@contracts';
import fs from 'node:fs/promises';
import { grep } from '../../infrastructure/git/grep';
import { codePath, isBinary, MAX_FILE_SIZE, readBytes } from './files';
import { visibleFiles } from './repository-state';
import { DomainError } from '../../models/domain-error';
import { isRepository, listFiles } from '../../infrastructure/git/read';

export interface SearchOptions extends importSearchOptions { signal?: AbortSignal }
type Match = Extract<SearchEvent, { type: 'match' }>;

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

/** Files over the viewer's bound are not searched, as in the Node fallback. */
async function withinBound(root: string, file: string): Promise<boolean> {
  try { return (await fs.stat(codePath(root, file))).size <= MAX_FILE_SIZE; } catch { return false; }
}

/**
 * Without a mask one `git grep` covers the tree (Git skips binary and ignored files itself);
 * a mask passes its files instead, in batches that fit on a command line.
 */
async function* gitMatches(root: string, options: SearchOptions, accept: (file: string) => boolean): AsyncGenerator<Match> {
  const batches: string[][] = [];
  if (!options.mask?.trim()) batches.push([]);
  else {
    let batch: string[] = [], length = 0;
    for (const file of (await visibleFiles(root)).filter(accept)) {
      if (batch.length && length + file.length > 20_000) { batches.push(batch); batch = []; length = 0; }
      batch.push(file); length += file.length + 1;
    }
    if (batch.length) batches.push(batch);
  }
  const bounded = new Map<string, boolean>();
  for (const batch of batches) {
    for await (const match of grep(root, batch, options)) {
      if (!accept(match.path)) continue;
      let small = bounded.get(match.path);
      if (small === undefined) bounded.set(match.path, small = await withinBound(root, match.path));
      if (small) yield match;
    }
  }
}

async function* nodeMatches(root: string, options: SearchOptions, accept: (file: string) => boolean): AsyncGenerator<Match> {
  const pattern = searchPattern(options);
  for (const file of (await listFiles(root)).filter(accept)) {
    options.signal?.throwIfAborted();
    const data = await readBytes(root, file).catch(error => {
      if (error instanceof DomainError && error.status === 404) return null;
      // An unsafe symlink must not escape project containment.
      if (error instanceof DomainError && error.status === 400) return null;
      throw error;
    });
    if (!data?.bytes || isBinary(data.bytes)) continue;
    let line = 0;
    for (const text of data.bytes.toString('utf8').split(/\r?\n/)) {
      options.signal?.throwIfAborted();
      line++;
      if (pattern.test(text)) yield { type: 'match', path: file, line, text };
    }
  }
}

export async function* searchCode(root: string, options: SearchOptions): AsyncGenerator<SearchEvent> {
  searchPattern(options);
  const accept = masks(options.mask);
  options.signal?.throwIfAborted();
  let count = 0;
  const foundFiles = new Set<string>();
  const matches = await isRepository(root) ? gitMatches(root, options, accept) : nodeMatches(root, options, accept);
  for await (const match of matches) {
    if (count >= MAX_MATCHES || (!foundFiles.has(match.path) && foundFiles.size >= MAX_SEARCH_FILES)) {
      // Leaving the loop closes the generator, which stops the Git process.
      yield { type: 'done', matches: count, files: foundFiles.size, truncated: true };
      return;
    }
    count++; foundFiles.add(match.path);
    yield match;
  }
  yield { type: 'done', matches: count, files: foundFiles.size, truncated: false };
}
