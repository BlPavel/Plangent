import { parseHTML } from 'linkedom';
import { relativePath, requestUrl } from '../integrations';
import { DocsSourceConfig, DocsSourceError, LinkPattern } from './types';

export function field(data: unknown, p?: string): unknown {
  if (p === undefined) return undefined;
  if (p === '' || p === '$') return data;
  let current = data;
  for (const key of p.replace(/^\$\./, '').split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
export function template(value: string, vars: Record<string, string>): string {
  return value.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(vars, key)) throw new DocsSourceError(`Unknown template parameter: ${key}`);
    return encodeURIComponent(vars[key]);
  });
}
export function matchLink(value: string, patterns: LinkPattern[]): { id?: string; title?: string; scope?: string } | undefined {
  if (value.length > 8192) throw new DocsSourceError('Link is too long');
  for (const p of patterns) {
    const match = new RegExp(p.pattern).exec(value);
    if (!match) continue;
    const read = (group?: number) => group === undefined || match[group] === undefined ? undefined : decodeURIComponent(match[group]);
    return { id: read(p.id_group), title: read(p.title_group), scope: read(p.scope_group) };
  }
}
export function serviceUrl(base: string, value: string): URL {
  const url = new URL(value, base);
  if (url.origin !== base || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new DocsSourceError('Link must belong to the connection service');
  return url;
}
export function validateConfig(value: unknown): DocsSourceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DocsSourceError('Expected source settings');
  const c = value as DocsSourceConfig;
  const text = (v: unknown, name: string, allowEmpty = false): void => {
    if (typeof v !== 'string' || (!allowEmpty && !v.trim())) throw new DocsSourceError(`${name} must be a string`);
  };
  const jsonPath = (v: unknown, name: string): void => {
    text(v, name, true);
    if (!/^(\$|\$\.)?[\w.-]*$/.test(v as string)) throw new DocsSourceError(`Invalid JSON path: ${name}`);
  };
  const endpoint = (v: unknown): void => {
    text(v, 'endpoint');
    const rendered = template(v as string, { id: 'sample', title: 'sample', scope: 'sample', offset: '0', limit: '100' });
    relativePath(rendered);
    requestUrl('https://docs.example', rendered);
  };
  endpoint(c.document_endpoint);
  if (c.metadata_endpoint !== undefined) endpoint(c.metadata_endpoint);
  if (c.document_path !== undefined) jsonPath(c.document_path, 'document_path');
  if (c.metadata_path !== undefined) jsonPath(c.metadata_path, 'metadata_path');
  if (!c.fields || typeof c.fields !== 'object') throw new DocsSourceError('Fields are required');
  for (const key of ['id', 'title', 'body'] as const) jsonPath(c.fields[key], key);
  for (const [k, v] of Object.entries(c.fields)) jsonPath(v, k);
  if (!['html', 'markdown'].includes(c.body_format)) throw new DocsSourceError('Invalid body format');
  for (const patterns of [c.link_patterns, c.internal_link_patterns ?? []]) {
    if (!Array.isArray(patterns)) throw new DocsSourceError('Link patterns must be an array');
    for (const p of patterns) {
      text(p.pattern, 'link pattern');
      if (p.pattern.length > 1000) throw new DocsSourceError('Link pattern is too long');
      try { new RegExp(p.pattern); } catch { throw new DocsSourceError('Invalid link pattern'); }
      for (const g of [p.id_group, p.title_group, p.scope_group]) if (g !== undefined && (!Number.isInteger(g) || g < 1)) throw new DocsSourceError('Capture groups start at 1');
      if (p.id_group === undefined && p.title_group === undefined) throw new DocsSourceError('A link pattern must capture id or title');
    }
  }
  for (const collection of [c.children, c.lookup]) if (collection) {
    endpoint(collection.endpoint); jsonPath(collection.items_path, 'items_path');
    const p = collection.pagination;
    if (p) {
      if (!['offset', 'next'].includes(p.mode)) throw new DocsSourceError('Invalid pagination mode');
      if (p.limit !== undefined && (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 1000)) throw new DocsSourceError('Invalid page limit');
      if (p.mode === 'next') jsonPath(p.next_path, 'next_path');
      if (p.total_path !== undefined) jsonPath(p.total_path, 'total_path');
      for (const name of [p.offset_parameter, p.limit_parameter]) if (name !== undefined && !/^[\w-]+$/.test(name)) throw new DocsSourceError('Invalid pagination parameter');
    }
  }
  if (c.original_url !== undefined) endpoint(c.original_url);
  const document = parseHTML('<html><body></body></html>').document;
  if (c.conversion_rules !== undefined && !Array.isArray(c.conversion_rules)) throw new DocsSourceError('Conversion rules must be an array');
  for (const r of c.conversion_rules ?? []) {
    text(r.selector, 'selector');
    if (!['code', 'callout', 'unwrap', 'skip', 'unknown'].includes(r.action)) throw new DocsSourceError('Invalid conversion action');
    for (const s of [r.selector, r.content?.selector, r.parameter?.selector]) if (s !== undefined) {
      text(s, 'selector');
      try { document.querySelector(s); } catch { throw new DocsSourceError(`Invalid selector: ${s}`); }
    }
    for (const a of [r.content?.attribute, r.parameter?.attribute, r.label]) if (a !== undefined) text(a, 'conversion parameter', true);
  }
  return JSON.parse(JSON.stringify(c)) as DocsSourceConfig;
}
