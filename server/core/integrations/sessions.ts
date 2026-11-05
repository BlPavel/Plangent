import * as records from '../../infrastructure/db/repositories/integrations/sessions';
import { IntegrationConnection } from '../../models/integrations';
import { getSecretVault } from '../../infrastructure/secrets';
import { effectiveCredential, credentialRow, requireConnection, IntegrationError, markNeedsUpdate } from './index';

import type { AuthContext, AuthSession } from '../../models/http-client';
export type { AuthContext, AuthSession, Cookie } from '../../models/http-client';
export function authContext(id: string): AuthContext {
  const connection = requireConnection(id), credential = effectiveCredential(connection);
  if (!credential || !credential.hasSecret || credential.status === 'needs_update') throw new IntegrationError(connection.auth_strategy === 'token' ? 'Обновите токен' : 'Обновите пароль учётки','needs_update',409);
  const row = credentialRow(credential.id)!;
  let password: string;
  try { password = getSecretVault().decrypt(row.secret_blob!); }
  catch { markNeedsUpdate(row.id,row.revision); throw new IntegrationError('Секрет недоступен: обновите пароль','needs_update',409); }
  return { connection, credential_id: row.id, revision: row.revision, username: row.username, password,
    signature: JSON.stringify([connection.base_url,connection.auth_strategy,connection.auth_config,connection.credential_mode,connection.organization_id,credential.id,credential.revision]) };
}
export function isCurrent(ctx: AuthContext): boolean {
  try { return authContext(ctx.connection.id).signature === ctx.signature; } catch { return false; }
}
export function rejectPassword(ctx: AuthContext): never {
  if (isCurrent(ctx)) markNeedsUpdate(ctx.credential_id,ctx.revision);
  throw new IntegrationError(ctx.connection.auth_strategy === 'token' ? 'Токен недействителен. Обновите токен' : 'Неверные данные учётки. Обновите пароль','invalid_credentials',401);
}
function load(ctx: AuthContext): AuthSession | null {
  const row = records.loadIntegrationSessions(ctx.connection.id) as { credential_id: string; credential_revision: number; secret_blob: Buffer; expires_at: string | null } | undefined;
  if (!row || row.credential_id !== ctx.credential_id || row.credential_revision !== ctx.revision || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) return null;
  try {
    const session = JSON.parse(getSecretVault().decrypt(row.secret_blob)) as AuthSession;
    if (typeof session.id !== 'string' || !['basic','form','token'].includes(session.strategy) || !Array.isArray(session.cookies)) throw new Error();
    return session;
  } catch {
    records.loadIntegrationSessions2(ctx.connection.id);
    markNeedsUpdate(ctx.credential_id,ctx.revision);
    throw new IntegrationError('Сессия недоступна: обновите пароль','needs_update',409);
  }
}
export function saveSession(ctx: AuthContext, session: AuthSession): void {
  if (!isCurrent(ctx)) throw new IntegrationError('Настройки или пароль изменились во время входа. Повторите запрос','configuration_changed',409);
  records.saveSessionIntegrationSessions(ctx.connection.id, ctx.credential_id, ctx.revision, getSecretVault().encrypt(JSON.stringify(session)));
}
export function clearSession(ctx: AuthContext, session: AuthSession): void {
  if (load(ctx)?.id !== session.id) return;
  records.clearSessionIfCredentialMatches(ctx.connection.id, ctx.credential_id, ctx.revision);
}
const flights = new Map<string, Promise<AuthSession>>();
export async function getSession(ctx: AuthContext, login: () => Promise<AuthSession>): Promise<AuthSession> {
  const cached = load(ctx); if (cached) return cached;
  const id = ctx.connection.id;
  const running = flights.get(id);
  if (running) { await running; if (!isCurrent(ctx)) throw new IntegrationError('Настройки изменились','configuration_changed',409); return getSession(ctx,login); }
  const pending = (async () => { const session = await login(); saveSession(ctx,session); return session; })();
  flights.set(id,pending);
  try { return await pending; } finally { if (flights.get(id) === pending) flights.delete(id); }
}
