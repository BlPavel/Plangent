import { setTimeout as delay } from 'node:timers/promises';
import { DocsSelection } from '../../models/integrations';
import { requestUrl } from '../integrations';
import { convertBody } from './convert';
import { field, template, serviceUrl, matchLink, validateConfig } from './config';
import { CollectionEndpoint, Diagnostics, DocsNode, DocsSourceConfig, DocsSourceError, SourceRequest, SyncProgress } from './types';

export class DocsSource {
  readonly config: DocsSourceConfig;
  readonly warnings: string[];
  constructor(readonly baseUrl: string, config: unknown, private readonly request: SourceRequest) {
    const url = new URL(baseUrl);
    if (url.origin !== baseUrl || !['http:', 'https:'].includes(url.protocol)) throw new DocsSourceError('Use the connection service origin');
    this.config = validateConfig(config);
    this.warnings = [
      ...(!this.config.fields.version ? ['No version field: every sync downloads all bodies to compare hashes.'] : []),
      ...(!this.config.children ? ['No children endpoint: subtree selections sync only the selected document; tree is unavailable.'] : []),
      ...(!this.config.metadata_endpoint ? ['No metadata endpoint: selected roots require a document request to check for changes.'] : []),
    ];
  }
  private async json(endpoint: string, signal?: AbortSignal, urls?: string[]): Promise<unknown> {
    const url = serviceUrl(this.baseUrl, requestUrl(this.baseUrl, endpoint));
    urls?.push(url.href);
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let reply;
      try { reply = await this.request(url.pathname + url.search, signal); }
      catch (error) {
        signal?.throwIfAborted();
        const e = error as { remote_status?: number; code?: string; headers?: Headers };
        if (attempt >= 3 || !(e.remote_status === 429 || (e.remote_status !== undefined && e.remote_status >= 500 && e.remote_status <= 599) || e.code === 'network')) throw error;
        await delay(this.retryDelay(attempt, e.headers), undefined, { signal });
        continue;
      }
      signal?.throwIfAborted();
      if (reply.status === 429 || (reply.status >= 500 && reply.status <= 599)) {
        if (attempt >= 3) throw new DocsSourceError(`Remote HTTP ${reply.status}`, 'remote_error');
        await delay(this.retryDelay(attempt, reply.headers), undefined, { signal }); continue;
      }
      if (reply.status < 200 || reply.status >= 300) throw new DocsSourceError(`Remote HTTP ${reply.status}`, 'remote_error');
      try { return JSON.parse(reply.body); } catch { throw new DocsSourceError('Response is not valid JSON', 'response'); }
    }
  }
  private retryDelay(attempt: number, headers?: Headers): number {
    const after = headers?.get('retry-after');
    const ms = after ? (/^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now()) : 200 * 2 ** attempt;
    return Math.max(0, Math.min(Number.isFinite(ms) ? ms : 200, 10000));
  }
  private extract(data: unknown, fallbackParent?: string): DocsNode {
    const f = this.config.fields;
    const scalar = (p?: string): string | undefined => {
      const v = field(data, p);
      return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : undefined;
    };
    const id = scalar(f.id), title = scalar(f.title);
    if (!id || !title) throw new DocsSourceError(`Missing required field: ${!id ? f.id : f.title}`, 'response');
    if (id.length > 512 || title.length > 10000) throw new DocsSourceError('Document identifier or title is too long', 'response');
    const rawUrl = scalar(f.url) ?? template(this.config.original_url ?? this.config.document_endpoint, { id });
    const ancestors = field(data, f.ancestors);
    return { id, title, url: serviceUrl(this.baseUrl, rawUrl).href, parent: scalar(f.parent) ?? fallbackParent,
      ancestors: Array.isArray(ancestors) ? ancestors.map(v => typeof v === 'object' ? scalarFrom(v, f.id) : String(v)).filter((v): v is string => !!v) : undefined,
      version: scalar(f.version), body: typeof field(data, f.body) === 'string' ? field(data, f.body) as string : undefined,
      updated: scalar(f.updated), space: scalar(f.space), author: scalar(f.author) };
  }
  async getDocument(id: string, signal?: AbortSignal, urls?: string[]): Promise<DocsNode> {
    const data = await this.json(template(this.config.document_endpoint, { id }), signal, urls);
    const node = this.extract(field(data, this.config.document_path ?? '$'));
    if (node.id !== id) throw new DocsSourceError('Response document id does not match request', 'response');
    if (node.body === undefined) throw new DocsSourceError(`Missing body field: ${this.config.fields.body}`, 'response');
    return node;
  }
  async getMetadata(id: string, signal?: AbortSignal): Promise<DocsNode> {
    if (!this.config.metadata_endpoint) return this.getDocument(id, signal);
    const data = await this.json(template(this.config.metadata_endpoint, { id }), signal);
    const node = this.extract(field(data, this.config.metadata_path ?? this.config.document_path ?? '$'));
    if (node.id !== id) throw new DocsSourceError('Response document id does not match request', 'response');
    return node;
  }
  private async collection(c: CollectionEndpoint, vars: Record<string, string>, signal?: AbortSignal, urls?: string[]): Promise<unknown[]> {
    const p = c.pagination, limit = p?.limit ?? 100;
    let offset = 0, endpoint = template(c.endpoint, { ...vars, offset: '0', limit: String(limit) });
    const seen = new Set<string>(), output: unknown[] = [];
    for (let page = 0; page < 10000; page++) {
      signal?.throwIfAborted();
      if (p?.mode === 'offset') {
        const url = serviceUrl(this.baseUrl, template(c.endpoint, { ...vars, offset: String(offset), limit: String(limit) }));
        url.searchParams.set(p.offset_parameter ?? 'offset', String(offset));
        url.searchParams.set(p.limit_parameter ?? 'limit', String(limit));
        endpoint = url.pathname + url.search;
      }
      const canonical = serviceUrl(this.baseUrl, endpoint);
      if (seen.has(canonical.href)) throw new DocsSourceError('Pagination cycle', 'response');
      seen.add(canonical.href);
      const data = await this.json(canonical.pathname + canonical.search, signal, urls);
      const items = field(data, c.items_path);
      if (!Array.isArray(items)) throw new DocsSourceError(`Missing collection field: ${c.items_path}`, 'response');
      output.push(...items);
      if (!p) return output;
      if (p.mode === 'next') {
        const next = field(data, p.next_path);
        if (next === undefined || next === null || next === '') return output;
        if (typeof next !== 'string') throw new DocsSourceError('Next-page link must be a string', 'response');
        const target = serviceUrl(this.baseUrl, new URL(next, canonical).href);
        endpoint = target.pathname + target.search;
      } else {
        offset += items.length;
        const total = field(data, p.total_path);
        if (total !== undefined && (typeof total !== 'number' || total < 0)) throw new DocsSourceError('Invalid collection total', 'response');
        if (!items.length || (typeof total === 'number' ? offset >= total : items.length < limit)) return output;
      }
    }
    throw new DocsSourceError('Pagination exceeded 10000 pages', 'response');
  }
  async resolveLink(input: string, signal?: AbortSignal): Promise<DocsNode> {
    const value = input.trim();
    if (!value) throw new DocsSourceError('Document id or link is required');
    // A non-URL value is a literal stable identifier.
    if (!/[\/:?#]/.test(value)) return this.getMetadata(value, signal);
    const url = serviceUrl(this.baseUrl, value);
    const match = matchLink(url.href, this.config.link_patterns);
    if (match?.id) return this.getMetadata(match.id, signal);
    if (match?.title && this.config.lookup) {
      const results = await this.collection(this.config.lookup, { title: match.title, scope: match.scope ?? '' }, signal);
      if (results.length !== 1) throw new DocsSourceError(`Title lookup returned ${results.length} documents; use a stable id`);
      return this.getMetadata(this.extract(results[0]).id, signal);
    }
    throw new DocsSourceError('Link does not match configured patterns');
  }
  async listChildren(id: string, signal?: AbortSignal): Promise<DocsNode[]> {
    if (!this.config.children) throw new DocsSourceError('Children endpoint is not configured', 'tree_unavailable');
    return (await this.collection(this.config.children, { id }, signal)).map(item => this.extract(item, id));
  }
  async discover(selection: DocsSelection[], signal?: AbortSignal, onProgress?: (p: SyncProgress) => void): Promise<Map<string, DocsNode>> {
    if (!Array.isArray(selection)) throw new DocsSourceError('Selection must be an array');
    const nodes = new Map<string, DocsNode>(), expanded = new Set<string>();
    for (const s of selection) {
      if (!s || typeof s.id !== 'string' || !s.id || typeof s.include_descendants !== 'boolean' || (s.excluded_ids !== undefined && (!Array.isArray(s.excluded_ids) || s.excluded_ids.some(id => typeof id !== 'string' || !id)))) throw new DocsSourceError('Invalid selection rule');
    }
    const excluded = new Set(selection.flatMap(s => s.excluded_ids ?? []));
    const queue: { node: DocsNode; expand: boolean; chain: string[] }[] = [];
    for (const s of selection) if (!excluded.has(s.id)) {
      const node = await this.getMetadata(s.id, signal), chain: string[] = [];
      let parent = node.parent;
      // Explicit roots may themselves be inside an excluded branch.
      while (excluded.size && parent) {
        if (chain.includes(parent) || parent === node.id) throw new DocsSourceError('Document tree contains a cycle', 'response');
        chain.push(parent);
        if (excluded.has(parent)) break;
        if (chain.length > 1000) throw new DocsSourceError('Ancestry exceeds 1000 documents', 'response');
        parent = (await this.getMetadata(parent, signal)).parent;
      }
      queue.push({ node, expand: s.include_descendants, chain });
    }
    for (let i = 0; i < queue.length; i++) {
      signal?.throwIfAborted();
      const { node, expand, chain } = queue[i];
      if (excluded.has(node.id) || (node.parent !== undefined && excluded.has(node.parent)) || node.ancestors?.some(id => excluded.has(id)) || chain.some(id => excluded.has(id))) continue;
      if (chain.includes(node.id)) throw new DocsSourceError('Document tree contains a cycle', 'response');
      if (!nodes.has(node.id)) { nodes.set(node.id, node); onProgress?.({ stage: 'discover', found: nodes.size, downloaded: 0 }); }
      if (nodes.size > 100000) throw new DocsSourceError('Tree exceeds the 100000 document limit');
      if (!expand || expanded.has(node.id) || !this.config.children) continue;
      expanded.add(node.id);
      for (const child of await this.listChildren(node.id, signal)) queue.push({ node: child, expand: true, chain: [...chain, node.id] });
    }
    return nodes;
  }
  async probe(input: string, signal?: AbortSignal): Promise<Diagnostics> {
    const urls: string[] = [], missing: string[] = [], extracted: Record<string, unknown> = {};
    let id = input.trim();
    if (/[\/:?#]/.test(id)) {
      const url = serviceUrl(this.baseUrl, id), match = matchLink(url.href, this.config.link_patterns);
      if (match?.id) id = match.id;
      else if (match?.title && this.config.lookup) {
        const results = await this.collection(this.config.lookup, { title: match.title, scope: match.scope ?? '' }, signal, urls);
        if (results.length !== 1) throw new DocsSourceError('Probe title lookup must return exactly one document');
        const resolved = field(results[0], this.config.fields.id);
        if (typeof resolved !== 'string' && typeof resolved !== 'number') throw new DocsSourceError(`Missing id field: ${this.config.fields.id}`);
        id = String(resolved);
      } else throw new DocsSourceError('Link does not match configured patterns');
    }
    if (!id) throw new DocsSourceError('Document id is required');
    const data = await this.json(template(this.config.document_endpoint, { id }), signal, urls);
    const document = field(data, this.config.document_path ?? '$');
    for (const [key, p] of Object.entries(this.config.fields)) {
      const v = field(document, p);
      if (v === undefined || v === null) missing.push(p);
      else extracted[key] = key === 'body' && typeof v === 'string' ? v.slice(0, 2000) : v;
    }
    const body = field(document, this.config.fields.body);
    const original = field(document, this.config.fields.url);
    const originalUrl = serviceUrl(this.baseUrl, typeof original === 'string' ? original : template(this.config.original_url ?? this.config.document_endpoint, { id })).href;
    return { urls, fields: extracted, missing, preview: typeof body === 'string' ? convertBody(body, this.config, originalUrl).slice(0, 2000) : '', warnings: this.warnings };
  }
}
function scalarFrom(data: unknown, p: string): string | undefined {
  const v = field(data, p); return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}
