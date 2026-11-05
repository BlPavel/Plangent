import { transaction } from '../../infrastructure/db/repositories/integrations/transaction';
import * as records from '../../infrastructure/db/repositories/integrations/index';
import { randomUUID } from 'node:crypto';
import { getSecretVault } from '../../infrastructure/secrets';
import { IntegrationOrganization, IntegrationCredential, IntegrationConnection, AuthStrategy, CredentialMode } from '../../models/integrations';

import { IntegrationError, object, relativePath, normalizeBaseUrl, text } from '../../infrastructure/http-client/config';
import type { AuthConfig } from '../../models/http-client';
export { IntegrationError, object, normalizeBaseUrl, relativePath, requestUrl } from '../../infrastructure/http-client/config';
export type { AuthConfig, ResponseRule } from '../../models/http-client';
export function validateAuthConfig(strategy: AuthStrategy, value: unknown): AuthConfig {
  const c = object(value);
  const allowed = new Set(['check_path','user_path','expect_json','timeout_ms','login_path','username_field','password_field','fields','headers','strategies','invalid_password','invalid_session','token_header','token_prefix','check_details']);
  for (const key of Object.keys(c)) if (!allowed.has(key)) throw new IntegrationError(`Unknown auth setting: ${key}`);
  relativePath(c.check_path);
  if (c.check_details !== undefined) {
    if (!Array.isArray(c.check_details) || c.check_details.length > 10) throw new IntegrationError('Invalid check details');
    for (const entry of c.check_details) {
      const item = object(entry);
      if (Object.keys(item).some(key => !['path','value_path','result_key','label'].includes(key)) || typeof item.value_path !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(item.value_path) || !['version','token_expires_at'].includes(String(item.result_key)) || typeof item.label !== 'string' || item.label.length > 100) throw new IntegrationError('Invalid check detail');
      relativePath(item.path);
    }
  }
  if (strategy === 'token') {
    if (typeof c.token_header !== 'string' || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(c.token_header) ||
        /^(host|cookie|set-cookie|content-length|transfer-encoding|connection|proxy-authorization)$/i.test(c.token_header)) throw new IntegrationError('Invalid token header');
    if (c.token_prefix !== undefined && (typeof c.token_prefix !== 'string' || !/^(?:[a-z][a-z0-9_-]* )?$/i.test(c.token_prefix))) throw new IntegrationError('Token prefix must be empty or an authentication scheme followed by a space');
  } else if (c.token_header !== undefined || c.token_prefix !== undefined) throw new IntegrationError('Token header settings require token authentication');
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
function required<T>(value: T | null): T { if (!value) throw new IntegrationError('Not found','not_found',404); return value; }
export function listOrganizations(): IntegrationOrganization[] { return records.listOrganizationsIntegrationOrganizations() as IntegrationOrganization[]; }
export function getOrganization(id: string): IntegrationOrganization | null { return records.getOrganizationIntegrationOrganizations(id) as IntegrationOrganization ?? null; }
export function saveOrganization(input: unknown, id: string = randomUUID()): IntegrationOrganization {
  const data = object(input), old = getOrganization(id);
  const name = text(data.name ?? old?.name,'name');
  const cid = data.credential_id === undefined ? old?.credential_id ?? null : data.credential_id;
  if (cid !== null && (typeof cid !== 'string' || credentialRow(cid)?.organization_id !== id)) throw new IntegrationError('Organization account must belong to this organization');
  transaction(() => {
    records.saveOrganizationIntegrationOrganizations(id, name, cid);
    if (old && old.credential_id !== cid) for (const c of listConnections().filter(c => c.organization_id === id && c.credential_mode === 'inherit')) invalidateConnection(c.id);
  });
  return required(getOrganization(id));
}
interface CredentialRow extends Omit<IntegrationCredential,'hasSecret'> { secret_blob: Buffer | null }
export function credentialRow(id: string): CredentialRow | null { return records.credentialRowIntegrationCredentials(id) as CredentialRow ?? null; }
function publicCredential(row: CredentialRow): IntegrationCredential { const { secret_blob, ...rest } = row; return { ...rest, hasSecret: Boolean(secret_blob) }; }
export function getCredential(id: string): IntegrationCredential | null { const r = credentialRow(id); return r ? publicCredential(r) : null; }
export function listCredentials(): IntegrationCredential[] {
  return (records.listCredentialsIntegrationCredentials() as CredentialRow[]).map(publicCredential);
}
export function saveCredential(input: unknown, id: string = randomUUID()): IntegrationCredential {
  const data = object(input), old = credentialRow(id);
  if ('password' in data || 'secret' in data || 'secret_blob' in data) throw new IntegrationError('Use the password endpoint');
  const org = data.organization_id === undefined ? old?.organization_id ?? null : data.organization_id;
  if (org !== null && (typeof org !== 'string' || !getOrganization(org))) throw new IntegrationError('Organization not found');
  if (old && org !== old.organization_id) throw new IntegrationError('Account organization cannot be changed');
  const name = text(data.name ?? old?.name,'name');
  const username = text(data.username ?? old?.username,'username');
  transaction(() => {
    records.saveCredentialIntegrationCredentials(id, org, name, username);
    if (old && username !== old.username) { records.saveCredentialIntegrationCredentials2(id); invalidateCredential(id); }
  });
  return required(getCredential(id));
}
export function invalidateConnection(id: string): void {
  records.invalidateConnectionIntegrationSessions(id);
  records.invalidateConnectionIntegrationConnections(id);
}
export function effectiveCredential(connection: IntegrationConnection): IntegrationCredential | null {
  const id = connection.credential_mode === 'inherit' ? (connection.organization_id ? getOrganization(connection.organization_id)?.credential_id : null) : connection.credential_id;
  return id ? getCredential(id) : null;
}
function invalidateCredential(id: string): void {
  records.invalidateCredentialIntegrationSessions(id);
  for (const c of listConnections()) if (effectiveCredential(c)?.id === id) invalidateConnection(c.id);
}
export function setPassword(id: string, password: unknown): IntegrationCredential {
  required(getCredential(id));
  if (typeof password !== 'string' || !password.length) throw new IntegrationError('Password is required');
  const blob = getSecretVault().encrypt(password);
  transaction(() => {
    records.setPasswordIntegrationCredentials(blob, id);
    invalidateCredential(id);
  });
  return required(getCredential(id));
}
export function markNeedsUpdate(id: string, revision: number): void {
  transaction(() => {
    if (records.markCredentialNeedsUpdateIfRevisionMatches(id, revision)) {
      invalidateCredential(id);
      for (const c of listConnections()) if (effectiveCredential(c)?.id === id) records.markNeedsUpdateIntegrationConnections(c.id);
    }
  });
}
function parseConnection(row: Record<string, unknown>): IntegrationConnection { return { ...row, auth_config: JSON.parse(row.auth_config as string) } as unknown as IntegrationConnection; }
export function getConnection(id: string): IntegrationConnection | null { const r = records.getConnectionIntegrationConnections(id); return r ? parseConnection(r as Record<string, unknown>) : null; }
export function listConnections(): IntegrationConnection[] { return (records.listConnectionsIntegrationConnections() as Record<string, unknown>[]).map(parseConnection); }
export function saveConnection(input: unknown, id: string = randomUUID()): IntegrationConnection {
  const data = object(input), old = getConnection(id);
  if (['password','secret','secret_blob'].some(key => key in data)) throw new IntegrationError('Use the password endpoint');
  const name = text(data.name ?? old?.name,'name');
  const base = normalizeBaseUrl(data.base_url ?? old?.base_url).base_url;
  const org = data.organization_id === undefined ? old?.organization_id ?? null : data.organization_id;
  if (org !== null && (typeof org !== 'string' || !getOrganization(org))) throw new IntegrationError('Organization not found');
  const mode = (data.credential_mode ?? old?.credential_mode ?? 'inherit') as CredentialMode;
  if (!['inherit','credential','own'].includes(mode)) throw new IntegrationError('Invalid account mode');
  const host = data.code_host === undefined ? old?.code_host ?? null : data.code_host;
  if (host !== null && !['gitlab', 'github'].includes(String(host))) throw new IntegrationError('Unsupported code host');
  const strategy = (data.auth_strategy ?? old?.auth_strategy ?? 'auto') as AuthStrategy;
  if (!['basic','form','auto','token','browser','api-login'].includes(strategy)) throw new IntegrationError('Invalid login strategy');
  const config = validateAuthConfig(strategy,data.auth_config ?? old?.auth_config ?? {});
  let cid = data.credential_id === undefined ? old?.credential_id ?? null : data.credential_id;
  if (mode === 'inherit') cid = null;
  if (mode === 'credential') {
    if (typeof cid !== 'string' || !listCredentials().some(c => c.id === cid && c.organization_id === org)) throw new IntegrationError('Choose an account from this organization');
  }
  if (mode === 'own' && old?.credential_mode !== 'own') cid = null;
  transaction(() => {
    if (mode === 'own') {
      if (old?.credential_mode === 'own') cid = old.credential_id;
      const own = object(data.own_credential ?? (cid ? getCredential(cid as string) : {}));
      if (['password','secret','secret_blob'].some(key => key in own)) throw new IntegrationError('Use the password endpoint');
      cid = saveCredential({ name: `${name} account`, username: own.username }, (cid ?? undefined) as string | undefined).id;
    }
    records.saveConnectionIntegrationConnections(id, name, base, org, mode, cid, strategy, JSON.stringify(config));
    invalidateConnection(id);
    records.saveConnectionIntegrationConnections2(host, id);
    if (old?.credential_mode === 'own' && old.credential_id && old.credential_id !== cid) records.saveConnectionIntegrationCredentials(old.credential_id);
  });
  return required(getConnection(id));
}
export function deleteConnection(id: string): void {
  const c = required(getConnection(id));
  if (records.deleteConnectionProjects(id)) throw new IntegrationError('Connection is used by a source','in_use',409);
  transaction(() => {
    records.deleteConnectionIntegrationConnections(id);
    if (c.credential_mode === 'own' && c.credential_id) records.deleteConnectionIntegrationCredentials(c.credential_id);
  });
}
export function deleteCredential(id: string): void {
  required(getCredential(id));
  if (listConnections().some(c => c.credential_mode === 'own' && c.credential_id === id)) throw new IntegrationError('Delete the owning connection first','in_use',409);
  transaction(() => { invalidateCredential(id); records.deleteCredentialIntegrationCredentials(id); });
}
export function deleteOrganization(id: string): void {
  required(getOrganization(id));
  transaction(() => {
    for (const c of listConnections().filter(c => c.organization_id === id)) invalidateConnection(c.id);
    for (const c of listCredentials().filter(c => c.organization_id === id)) invalidateCredential(c.id);
    records.deleteOrganizationIntegrationOrganizations(id);
  });
}
export function requireConnection(id: string): IntegrationConnection { return required(getConnection(id)); }

export { getSecretVault, SecretVaultError } from '../../infrastructure/secrets';

export { authenticatedRequest } from './http-client';
