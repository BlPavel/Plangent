import { randomUUID } from 'node:crypto';
import { getDb } from '../../infrastructure/db/schema';
import { getSecretVault } from '../../infrastructure/secrets';
import { IntegrationOrganization, IntegrationCredential, IntegrationConnection, AuthStrategy, CredentialMode } from '../../models/integrations';

export class IntegrationError extends Error {
  constructor(message: string, public readonly code = 'validation', public readonly status = 400) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntegrationError('Expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
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
export interface ResponseRule { statuses?: number[]; redirect_path?: string; header?: { name: string; value: string }; html_instead_of_json?: boolean }
export interface AuthConfig {
  check_path: string; user_path?: string; expect_json?: boolean; timeout_ms?: number;
  login_path?: string; username_field?: string; password_field?: string;
  fields?: Record<string, string>; headers?: Record<string, string>; strategies?: ('basic' | 'form')[];
  invalid_password?: ResponseRule; invalid_session?: ResponseRule;
}
export function validateAuthConfig(strategy: AuthStrategy, value: unknown): AuthConfig {
  const c = object(value);
  const allowed = new Set(['check_path','user_path','expect_json','timeout_ms','login_path','username_field','password_field','fields','headers','strategies','invalid_password','invalid_session']);
  for (const key of Object.keys(c)) if (!allowed.has(key)) throw new IntegrationError(`Unknown auth setting: ${key}`);
  relativePath(c.check_path);
  if (c.user_path !== undefined && (typeof c.user_path !== 'string' || !/^[\w.-]+$/.test(c.user_path))) throw new IntegrationError('Invalid JSON user path');
  if (c.expect_json !== undefined && typeof c.expect_json !== 'boolean') throw new IntegrationError('expect_json must be boolean');
  if (c.timeout_ms !== undefined && (!Number.isInteger(c.timeout_ms) || Number(c.timeout_ms) < 100 || Number(c.timeout_ms) > 120000)) throw new IntegrationError('Invalid timeout');
  if (strategy === 'auto' && (!Array.isArray(c.strategies) || !c.strategies.length || new Set(c.strategies).size !== c.strategies.length || c.strategies.some(s => s !== 'basic' && s !== 'form'))) throw new IntegrationError('auto requires an ordered list of basic/form strategies');
  if (strategy === 'form' || (strategy === 'auto' && (c.strategies as string[]).includes('form'))) {
    relativePath(c.login_path); text(c.username_field, 'username_field'); text(c.password_field, 'password_field');
    if (c.username_field === c.password_field) throw new IntegrationError('Login field names must differ');
  } else if (c.login_path !== undefined) relativePath(c.login_path);
  for (const key of ['fields','headers']) if (c[key] !== undefined) {
    const entries = object(c[key]);
    for (const [name, v] of Object.entries(entries)) {
      if (typeof v !== 'string' || /[\r\n]/.test(name + v) || (/password|secret|authorization|cookie/i.test(name) || (/token/i.test(name) && !(key === 'headers' && v === 'no-check'))) || (key === 'fields' && [c.username_field,c.password_field].includes(name))) throw new IntegrationError('Secrets must be set through the password endpoint');
    }
  }
  for (const key of ['invalid_password','invalid_session']) if (c[key] !== undefined) {
    const rule = object(c[key]);
    for (const k of Object.keys(rule)) if (!['statuses','redirect_path','header','html_instead_of_json'].includes(k)) throw new IntegrationError('Unknown response rule');
    if (rule.statuses !== undefined && (!Array.isArray(rule.statuses) || rule.statuses.some(s => !Number.isInteger(s) || s < 100 || s > 599))) throw new IntegrationError('Invalid response statuses');
    if (rule.redirect_path !== undefined) relativePath(rule.redirect_path);
    if (rule.html_instead_of_json !== undefined && typeof rule.html_instead_of_json !== 'boolean') throw new IntegrationError('Invalid HTML rule');
    if (rule.header !== undefined) { const h = object(rule.header); text(h.name,'header name'); text(h.value,'header value'); }
  }
  return c as unknown as AuthConfig;
}
const db = getDb;
function required<T>(value: T | null): T { if (!value) throw new IntegrationError('Not found','not_found',404); return value; }
export function listOrganizations(): IntegrationOrganization[] { return db().prepare('SELECT * FROM integration_organizations ORDER BY name').all() as IntegrationOrganization[]; }
export function getOrganization(id: string): IntegrationOrganization | null { return db().prepare('SELECT * FROM integration_organizations WHERE id=?').get(id) as IntegrationOrganization ?? null; }
export function saveOrganization(input: unknown, id: string = randomUUID()): IntegrationOrganization {
  const data = object(input), old = getOrganization(id);
  const name = text(data.name ?? old?.name,'name');
  const cid = data.credential_id === undefined ? old?.credential_id ?? null : data.credential_id;
  if (cid !== null && (typeof cid !== 'string' || credentialRow(cid)?.organization_id !== id)) throw new IntegrationError('Organization account must belong to this organization');
  db().transaction(() => {
    db().prepare(`INSERT INTO integration_organizations(id,name,credential_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, credential_id=excluded.credential_id, updated_at=datetime('now')`).run(id,name,cid);
    if (old && old.credential_id !== cid) for (const c of listConnections().filter(c => c.organization_id === id && c.credential_mode === 'inherit')) invalidateConnection(c.id);
  })();
  return required(getOrganization(id));
}
interface CredentialRow extends Omit<IntegrationCredential,'hasSecret'> { secret_blob: Buffer | null }
export function credentialRow(id: string): CredentialRow | null { return db().prepare('SELECT * FROM integration_credentials WHERE id=?').get(id) as CredentialRow ?? null; }
function publicCredential(row: CredentialRow): IntegrationCredential { const { secret_blob, ...rest } = row; return { ...rest, hasSecret: Boolean(secret_blob) }; }
export function getCredential(id: string): IntegrationCredential | null { const r = credentialRow(id); return r ? publicCredential(r) : null; }
export function listCredentials(): IntegrationCredential[] {
  return (db().prepare(`SELECT * FROM integration_credentials WHERE id NOT IN (SELECT credential_id FROM integration_connections WHERE credential_mode='own' AND credential_id IS NOT NULL) ORDER BY name`).all() as CredentialRow[]).map(publicCredential);
}
export function saveCredential(input: unknown, id: string = randomUUID()): IntegrationCredential {
  const data = object(input), old = credentialRow(id);
  if ('password' in data || 'secret' in data || 'secret_blob' in data) throw new IntegrationError('Use the password endpoint');
  const org = data.organization_id === undefined ? old?.organization_id ?? null : data.organization_id;
  if (org !== null && (typeof org !== 'string' || !getOrganization(org))) throw new IntegrationError('Organization not found');
  if (old && org !== old.organization_id) throw new IntegrationError('Account organization cannot be changed');
  const name = text(data.name ?? old?.name,'name');
  const username = text(data.username ?? old?.username,'username');
  db().transaction(() => {
    db().prepare(`INSERT INTO integration_credentials(id,organization_id,name,username) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username, updated_at=datetime('now')`).run(id,org,name,username);
    if (old && username !== old.username) { db().prepare(`UPDATE integration_credentials SET revision=revision+1, status='needs_update' WHERE id=?`).run(id); invalidateCredential(id); }
  })();
  return required(getCredential(id));
}
export function invalidateConnection(id: string): void {
  db().prepare('DELETE FROM integration_sessions WHERE connection_id=?').run(id);
  db().prepare(`UPDATE integration_connections SET last_check_status='unchecked',last_check_at=NULL,last_check_message='' WHERE id=?`).run(id);
}
export function effectiveCredential(connection: IntegrationConnection): IntegrationCredential | null {
  const id = connection.credential_mode === 'inherit' ? (connection.organization_id ? getOrganization(connection.organization_id)?.credential_id : null) : connection.credential_id;
  return id ? getCredential(id) : null;
}
function invalidateCredential(id: string): void {
  db().prepare('DELETE FROM integration_sessions WHERE credential_id=?').run(id);
  for (const c of listConnections()) if (effectiveCredential(c)?.id === id) invalidateConnection(c.id);
}
export function setPassword(id: string, password: unknown): IntegrationCredential {
  required(getCredential(id));
  if (typeof password !== 'string' || !password.length) throw new IntegrationError('Password is required');
  const blob = getSecretVault().encrypt(password);
  db().transaction(() => {
    db().prepare(`UPDATE integration_credentials SET secret_blob=?,status='ready',revision=revision+1,updated_at=datetime('now') WHERE id=?`).run(blob,id);
    invalidateCredential(id);
  })();
  return required(getCredential(id));
}
export function markNeedsUpdate(id: string, revision: number): void {
  db().transaction(() => {
    if (db().prepare(`UPDATE integration_credentials SET status='needs_update' WHERE id=? AND revision=?`).run(id,revision).changes) {
      invalidateCredential(id);
      for (const c of listConnections()) if (effectiveCredential(c)?.id === id) db().prepare(`UPDATE integration_connections SET last_check_status='needs_update' WHERE id=?`).run(c.id);
    }
  })();
}
function parseConnection(row: Record<string, unknown>): IntegrationConnection { return { ...row, auth_config: JSON.parse(row.auth_config as string) } as unknown as IntegrationConnection; }
export function getConnection(id: string): IntegrationConnection | null { const r = db().prepare('SELECT * FROM integration_connections WHERE id=?').get(id); return r ? parseConnection(r as Record<string, unknown>) : null; }
export function listConnections(): IntegrationConnection[] { return (db().prepare('SELECT * FROM integration_connections ORDER BY name').all() as Record<string, unknown>[]).map(parseConnection); }
export function saveConnection(input: unknown, id: string = randomUUID()): IntegrationConnection {
  const data = object(input), old = getConnection(id);
  if (['password','secret','secret_blob'].some(key => key in data)) throw new IntegrationError('Use the password endpoint');
  const name = text(data.name ?? old?.name,'name');
  const base = normalizeBaseUrl(data.base_url ?? old?.base_url).base_url;
  const org = data.organization_id === undefined ? old?.organization_id ?? null : data.organization_id;
  if (org !== null && (typeof org !== 'string' || !getOrganization(org))) throw new IntegrationError('Organization not found');
  const mode = (data.credential_mode ?? old?.credential_mode ?? 'inherit') as CredentialMode;
  if (!['inherit','credential','own'].includes(mode)) throw new IntegrationError('Invalid account mode');
  const strategy = (data.auth_strategy ?? old?.auth_strategy ?? 'auto') as AuthStrategy;
  if (!['basic','form','auto','token','browser','api-login'].includes(strategy)) throw new IntegrationError('Invalid login strategy');
  const config = validateAuthConfig(strategy,data.auth_config ?? old?.auth_config ?? {});
  let cid = data.credential_id === undefined ? old?.credential_id ?? null : data.credential_id;
  if (mode === 'inherit') cid = null;
  if (mode === 'credential') {
    if (typeof cid !== 'string' || !listCredentials().some(c => c.id === cid && c.organization_id === org)) throw new IntegrationError('Choose an account from this organization');
  }
  if (mode === 'own' && old?.credential_mode !== 'own') cid = null;
  db().transaction(() => {
    if (mode === 'own') {
      if (old?.credential_mode === 'own') cid = old.credential_id;
      const own = object(data.own_credential ?? (cid ? getCredential(cid as string) : {}));
      if (['password','secret','secret_blob'].some(key => key in own)) throw new IntegrationError('Use the password endpoint');
      cid = saveCredential({ name: `${name} account`, username: own.username }, (cid ?? undefined) as string | undefined).id;
    }
    db().prepare(`INSERT INTO integration_connections(id,name,base_url,organization_id,credential_mode,credential_id,auth_strategy,auth_config) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,organization_id=excluded.organization_id,credential_mode=excluded.credential_mode,credential_id=excluded.credential_id,auth_strategy=excluded.auth_strategy,auth_config=excluded.auth_config,updated_at=datetime('now')`).run(id,name,base,org,mode,cid,strategy,JSON.stringify(config));
    invalidateConnection(id);
    if (old?.credential_mode === 'own' && old.credential_id && old.credential_id !== cid) db().prepare('DELETE FROM integration_credentials WHERE id=?').run(old.credential_id);
  })();
  return required(getConnection(id));
}
export function deleteConnection(id: string): void {
  const c = required(getConnection(id));
  if (db().prepare('SELECT 1 FROM projects WHERE connection_id=?').get(id)) throw new IntegrationError('Connection is used by a source','in_use',409);
  db().transaction(() => {
    db().prepare('DELETE FROM integration_connections WHERE id=?').run(id);
    if (c.credential_mode === 'own' && c.credential_id) db().prepare('DELETE FROM integration_credentials WHERE id=?').run(c.credential_id);
  })();
}
export function deleteCredential(id: string): void {
  required(getCredential(id));
  if (listConnections().some(c => c.credential_mode === 'own' && c.credential_id === id)) throw new IntegrationError('Delete the owning connection first','in_use',409);
  db().transaction(() => { invalidateCredential(id); db().prepare('DELETE FROM integration_credentials WHERE id=?').run(id); })();
}
export function deleteOrganization(id: string): void {
  required(getOrganization(id));
  db().transaction(() => {
    for (const c of listConnections().filter(c => c.organization_id === id)) invalidateConnection(c.id);
    for (const c of listCredentials().filter(c => c.organization_id === id)) invalidateCredential(c.id);
    db().prepare('DELETE FROM integration_organizations WHERE id=?').run(id);
  })();
}
export function requireConnection(id: string): IntegrationConnection { return required(getConnection(id)); }
