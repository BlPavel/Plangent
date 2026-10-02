import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DocsSelection } from '../../models/integrations';
import { slugify } from '../shared/slugify';
import { convertBody } from './convert';
import { DocsSource } from './source';
import { ConfirmationRequired, DocsManifest, DocsNode, DocsSourceError, DocsSyncStats, ManifestEntry, SyncOptions, SyncResult } from './types';

const running = new Set<string>();
// A confirmation resumes this discovery; settings/manifest changes invalidate it.
const plans = new Map<string, { key: string; expires: number; nodes: Map<string, DocsNode> }>();
const planLifetime = 10 * 60 * 1000;
export function discardSyncPlan(root: string): void { plans.delete(path.resolve(root).toLowerCase()); }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const manifestName = '.manifest.json';
export function checkedFile(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(s => s === '..' || s === '.' || !s)) throw new DocsSourceError('Invalid managed file path');
  const absoluteRoot = path.resolve(root), file = path.resolve(root, relative);
  if (!file.startsWith(absoluteRoot + path.sep)) throw new DocsSourceError('Managed file escaped source directory');
  let current = absoluteRoot;
  // Reject symlinks, including existing ancestors of the managed root.
  for (let ancestor = absoluteRoot; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw new DocsSourceError('Managed directory must not contain symlinks');
    if (path.dirname(ancestor) === ancestor) break;
  }
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new DocsSourceError('Managed directory must not contain symlinks');
  }
  return file;
}
export function atomicWrite(root: string, relative: string, content: string): void {
  const file = checkedFile(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + randomUUID();
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function readManifest(root: string): DocsManifest | undefined {
  const file = checkedFile(root, manifestName);
  if (!fs.existsSync(file)) return undefined;
  let m: DocsManifest;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new DocsSourceError('Invalid source manifest; sync stopped to protect existing files', 'manifest'); }
  if (m.format !== 1 || typeof m.source !== 'string' || !m.entries || typeof m.entries !== 'object' || Array.isArray(m.entries)) throw new DocsSourceError('Unsupported source manifest', 'manifest');
  for (const [id, entry] of Object.entries(m.entries)) {
    if (!entry?.node || entry.node.id !== id || typeof entry.node.title !== 'string' || typeof entry.body !== 'string' || typeof entry.hash !== 'string' || typeof entry.path !== 'string' || !entry.path.endsWith('.md') || entry.path === 'INDEX.md' || entry.path.endsWith('/INDEX.md')) throw new DocsSourceError('Invalid manifest entry', 'manifest');
    checkedFile(root, entry.path);
  }
  m.entries = Object.assign(Object.create(null), m.entries);
  return m;
}
function pathsFor(nodes: Map<string, DocsNode>): Map<string, string> {
  const parents = new Set([...nodes.values()].map(n => n.parent).filter((id): id is string => !!id && nodes.has(id)));
  const paths = new Map<string, string>(), visiting = new Set<string>(), used = new Set<string>();
  const assign = (id: string): string => {
    const existing = paths.get(id); if (existing) return existing;
    if (visiting.has(id)) throw new DocsSourceError('Parent fields contain a cycle', 'response');
    visiting.add(id);
    const n = nodes.get(id)!;
    let folder = n.parent && nodes.has(n.parent) ? path.posix.dirname(assign(n.parent)) : '';
    if (folder === '.') folder = '';
    // Stable hash keeps case-only ids and truncated titles distinct on every platform.
    const segment = slugify(n.title).slice(0, 40) + '-' + slugify(id).slice(0, 20) + '-' + hash(id).slice(0, 12);
    const tail = parents.has(id) ? segment + '/document.md' : segment + '.md';
    if ((folder + '/' + tail).length > 180) folder = '';
    let file = folder ? folder + '/' + tail : tail;
    if (used.has(file.toLowerCase())) file = segment + '-' + hash(id) + (parents.has(id) ? '/document.md' : '.md');
    used.add(file.toLowerCase()); paths.set(id, file); visiting.delete(id); return file;
  };
  for (const id of nodes.keys()) assign(id);
  return paths;
}
function frontMatter(n: DocsNode): string {
  const fields = { title: n.title, id: n.id, url: n.url, version: n.version ?? '', updated: n.updated ?? '', space: n.space ?? '', author: n.author ?? '' };
  return '---\n' + Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n\n';
}
function indexes(m: DocsManifest, title: string): Map<string, string> {
  const folders = new Set<string>(['']);
  for (const entry of Object.values(m.entries)) {
    let folder = path.posix.dirname(entry.path);
    while (folder !== '.') { folders.add(folder); const next = path.posix.dirname(folder); if (next === folder) break; folder = next; }
  }
  const result = new Map<string, string>(), childCounts = new Map<string, number>();
  for (const e of Object.values(m.entries)) if (e.node.parent) childCounts.set(e.node.parent, (childCounts.get(e.node.parent) ?? 0) + 1);
  for (const folder of folders) {
    const entries = Object.values(m.entries).filter(e => !folder || e.path.startsWith(folder + '/')).sort((a, b) => a.path.localeCompare(b.path));
    const lines = [`# ${title.replace(/[\r\n]/g, ' ')}`, '', `Source: ${m.service_url ?? 'Configured service'}`, '', `Synced: ${m.synced_at}`, '', `Selection: ${m.selection.map(s => `${s.id} (${s.include_descendants ? 'subtree' : 'document'}${s.excluded_ids?.length ? '; excludes ' + s.excluded_ids.join(', ') : ''})`).join('; ')}`, '', 'Read these Markdown files locally; remote access is not required.', ''];
    for (const e of entries) {
      const label = e.node.title.replace(/[\[\]\\\r\n]/g, ' '), target = path.posix.relative(folder || '.', e.path);
      const snippet = e.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 180);
      lines.push(`- [${label}](${target}) — ${snippet}`, `  id: ${e.node.id}; version: ${e.node.version ?? 'body hash'}; parent: ${e.node.parent ?? 'root'}; children: ${(childCounts.get(e.node.id) ?? 0)}`);
    }
    result.set(folder ? folder + '/INDEX.md' : 'INDEX.md', lines.join('\n') + '\n');
  }
  return result;
}

/** Discovery and downloads precede publication. Cancellation cannot truncate the last usable snapshot. */
export async function syncSource(source: DocsSource, root: string, selection: DocsSelection[], options: SyncOptions = {}): Promise<SyncResult> {
  const lock = path.resolve(root).toLowerCase();
  if (running.has(lock)) throw new DocsSourceError('A sync is already running for this source', 'sync_running');
  const concurrency = options.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 2 || concurrency > 4) throw new DocsSourceError('Concurrency must be between 2 and 4');
  running.add(lock);
  try {
    const old = readManifest(root);
    const signature = hash(source.baseUrl + JSON.stringify(source.config));
    options.signal?.throwIfAborted();
    const key = hash(signature + JSON.stringify(selection) + JSON.stringify(old));
    const saved = plans.get(lock);
    for (const [id, plan] of plans) if (plan.expires <= Date.now()) plans.delete(id);
    let nodes: Map<string, DocsNode>;
    if (options.confirmed_large) {
      if (!saved || saved.expires <= Date.now() || saved.key !== key) {
        plans.delete(lock);
        throw new DocsSourceError('Download plan expired or settings changed; run Update again', 'confirmation_expired');
      }
      nodes = saved.nodes;
      plans.delete(lock);
    } else {
      plans.delete(lock);
      nodes = await source.discover(selection, options.signal, options.onProgress);
    }
    const unchanged = (node: DocsNode) => old?.source === signature && node.version !== undefined && old.entries[node.id]?.node.version === node.version;
    const total = [...nodes.values()].filter(node => !unchanged(node)).length;
    if (total > 500 && !options.confirmed_large) {
      plans.set(lock, { key, expires: Date.now() + planLifetime, nodes });
      throw new ConfirmationRequired(total, nodes.size);
    }
    const stats: DocsSyncStats = { found: nodes.size, downloaded: 0, added: 0, updated: 0, deleted: 0, errors: 0 };
    const warnings = [...source.warnings], entries = new Map<string, ManifestEntry>();
    const pending = [...nodes.values()].filter(node => !unchanged(node)); let cursor = 0, processed = 0;
    for (const node of nodes.values()) if (unchanged(node)) {
      entries.set(node.id, { ...old!.entries[node.id], node: { ...node, body: undefined } });
    }
    if (source.config.fields.version && pending.some(node => node.version === undefined)) warnings.push('Some metadata lacks the configured version field: those bodies are downloaded to compare hashes.');
    options.onProgress?.({ stage: 'download', found: nodes.size, downloaded: 0, processed: 0, total });
    const workers = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      while (cursor < pending.length) {
        options.signal?.throwIfAborted();
        const metadata = pending[cursor++], previous = old?.entries[metadata.id];
        try {
          const document = metadata.body !== undefined ? metadata : await source.getDocument(metadata.id, options.signal);
          options.signal?.throwIfAborted();
          const body = document.body!, digest = hash(body);
          entries.set(document.id, { node: { ...document, parent: metadata.parent ?? document.parent, body: undefined }, body, hash: digest, path: '' });
          stats.downloaded++;
          if (!previous) stats.added++;
          else if (previous.hash !== digest || previous.node.version !== document.version) stats.updated++;
        } catch (error) {
          options.signal?.throwIfAborted();
          stats.errors++; warnings.push(`Document ${metadata.id}: ${error instanceof Error ? error.message : 'download failed'}`);
          if (previous) entries.set(metadata.id, previous);
        }
        options.onProgress?.({ stage: 'download', found: nodes.size, downloaded: stats.downloaded, processed: ++processed, total });
      }
    }));
    const failed = workers.find((worker): worker is PromiseRejectedResult => worker.status === 'rejected');
    if (failed) throw failed.reason;
    options.signal?.throwIfAborted();
    const paths = pathsFor(new Map([...entries].map(([id, e]) => [id, e.node])));
    const m: DocsManifest = { format: 1, source: signature, service_url: source.baseUrl, synced_at: new Date().toISOString(), selection, entries: Object.create(null) };
    const output = new Map<string, string>();
    for (const [id, entry] of entries) {
      entry.path = paths.get(id)!; m.entries[id] = entry;
      output.set(entry.path, frontMatter(entry.node) + convertBody(entry.body, source.config, entry.node.url, entry.path, paths) + '\n');
    }
    const newIndexes = indexes(m, 'Documentation source');
    for (const [file, content] of newIndexes) output.set(file, content);
    // Preflight the complete write set before making any file changes.
    for (const file of output.keys()) checkedFile(root, file);
    options.signal?.throwIfAborted();
    for (const [file, content] of output) {
      const absolute = checkedFile(root, file);
      if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content) atomicWrite(root, file, content);
    }
    atomicWrite(root, manifestName, JSON.stringify(m, null, 2) + '\n');
    const stale = new Set<string>();
    for (const [id, entry] of Object.entries(old?.entries ?? {})) {
      if (!m.entries[id]) stats.deleted++;
      if (!output.has(entry.path)) stale.add(entry.path);
    }
    if (old) for (const file of indexes(old, '').keys()) if (!newIndexes.has(file)) stale.add(file);
    for (const file of stale) {
      const absolute = checkedFile(root, file);
      if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
      for (let dir = path.dirname(absolute); dir !== path.resolve(root) && fs.existsSync(dir) && !fs.readdirSync(dir).length; dir = path.dirname(dir)) fs.rmdirSync(dir);
    }
    options.onProgress?.({ stage: 'done', found: nodes.size, downloaded: stats.downloaded, processed, total });
    return { stats, warnings, manifest: m };
  } finally { running.delete(lock); }
}
