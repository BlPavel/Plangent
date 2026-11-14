import { IntegrationError } from '../../models/integration-error';
export { IntegrationError } from '../../models/integration-error';
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntegrationError('Expected an object');
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new IntegrationError(`${field} is required`);
  return value.trim();
}
export function normalizeBaseUrl(value: unknown): { base_url: string; normalized: boolean } {
  let url: URL;
  try { url = new URL(text(value, 'base_url')); } catch { throw new IntegrationError('Invalid service URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new IntegrationError('Use an HTTP(S) service URL without credentials');
  return { base_url: url.origin, normalized: value !== url.origin };
}
export function relativePath(value: unknown): string {
  const p = text(value, 'relative path');
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//') || /[\\\r\n#]/.test(p) || /(^|\/)\.\.(\/|$)/.test(p.split('?')[0])) throw new IntegrationError('Paths must be relative to the service root');
  return p.startsWith('/') ? p : '/' + p;
}
export function requestUrl(base: string, p: string): string {
  const url = new URL(relativePath(p), base);
  if (url.origin !== base) throw new IntegrationError('Request must stay on the service origin');
  return url.href;
}
export type { AuthConfig, ResponseRule } from '../../models/http-client';
import type { AuthConfig, ResponseRule } from '../../models/http-client';
