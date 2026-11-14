import * as records from '../../infrastructure/db/repositories/integrations/http-client';
import { AuthConfig, IntegrationError, requestUrl, requireConnection, markNeedsUpdate } from './index';
import { AuthContext, authContext, getSession, clearSession, saveSession, isCurrent, rejectPassword } from './sessions';
import { HttpReply, Send, login, strategyFor, matches } from '../../infrastructure/http-client/strategies';
import { createSend, IntegrationHttpError } from '../../infrastructure/http-client/integration-client';

const send = createSend(isCurrent);
export async function authenticatedRequest(id: string,p: string,options?: Parameters<Send>[3]): Promise<HttpReply> {
  const connection = requireConnection(id);
  const target = requestUrl(connection.base_url,p);
  let ctx: AuthContext | undefined;
  try {
    ctx = authContext(id);
    const active = ctx, c = ctx.connection.auth_config as unknown as AuthConfig;
    let session = await getSession(ctx,() => login(active,send));
    let reply = await send(ctx,session,p,options);
    if (matches(reply,c.invalid_password) || session.strategy === 'token' && reply.status === 401) rejectPassword(ctx);
    if (strategyFor(session).isAuthError(reply,c)) {
      clearSession(ctx,session);
      session = await getSession(ctx,() => login(active,send));
      reply = await send(ctx,session,p,options);
      if (matches(reply,c.invalid_password) || strategyFor(session).isAuthError(reply,c)) rejectPassword(ctx);
    }
    if (!isCurrent(ctx)) throw new IntegrationError('Настройки изменились во время запроса','configuration_changed',409);
    if (reply.status === 403) throw new IntegrationHttpError(new IntegrationError('Нет прав доступа','forbidden',403),reply.url);
    if (reply.status < 200 || reply.status >= 300) throw new IntegrationHttpError(new IntegrationError('Сервис вернул ошибку','remote_error',502),reply.url,reply.status,reply.headers);
    saveSession(ctx,session);
    return reply;
  } catch (e) {
    options?.signal?.throwIfAborted();
    if (ctx && e instanceof IntegrationError && e.code === 'invalid_credentials' && isCurrent(ctx)) markNeedsUpdate(ctx.credential_id, ctx.revision);
    if (e instanceof IntegrationHttpError) throw e;
    if (e instanceof IntegrationError) throw new IntegrationHttpError(e,ctx?.last_url ?? target);
    throw new IntegrationHttpError(new IntegrationError('Ошибка подключения','remote_error',502),target);
  }
}
export interface ConnectionCheck { ok: boolean; status: string; message: string; url: string; user?: string; version?: string; token_expires_at?: string }
export async function checkConnection(id: string): Promise<ConnectionCheck> {
  const c = requireConnection(id), config = c.auth_config as unknown as AuthConfig;
  let result: ConnectionCheck;
  try {
    const reply = await authenticatedRequest(id,config.check_path);
    let user: unknown;
    if (config.user_path) {
      try {
        let data: unknown = JSON.parse(reply.body);
        for (const key of config.user_path.split('.')) data = data && typeof data === 'object' && Object.hasOwn(data,key) ? (data as Record<string,unknown>)[key] : undefined;
        user = data;
      } catch { throw new IntegrationHttpError(new IntegrationError('Ожидался JSON с именем пользователя','unsupported_auth',422),reply.url); }
      if (typeof user !== 'string' || !user.trim()) throw new IntegrationHttpError(new IntegrationError('Имя пользователя не найдено в ответе','unsupported_auth',422),reply.url);
    }
    result = { ok: true,status: 'ok',message: typeof user === 'string' ? `Вошли как ${user}` : 'Подключение работает',url: reply.url,...(typeof user === 'string' ? { user } : {}) };
  } catch (e) {
    if (!(e instanceof IntegrationHttpError)) throw e;
    result = { ok: false,status: e.code,message: e.message,url: e.url };
  }
  if (result.ok) for (const detail of config.check_details ?? []) {
    try {
      let value: unknown = JSON.parse((await authenticatedRequest(id, detail.path)).body);
      for (const key of detail.value_path.split('.')) value = value && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
      if (typeof value === 'string') {
        result[detail.result_key] = value;
        result.message += ' · ' + detail.label + ' ' + value;
      }
    } catch (error) {
      // Old server versions may not expose optional diagnostics.
      if (error instanceof SyntaxError) continue;
      if (!(error instanceof IntegrationHttpError) || ![403, 404, 405].includes(error.remote_status ?? error.status)) throw error;
    }
  }
  if (result.status !== 'configuration_changed') records.checkConnectionIntegrationConnections(result.ok ? 'ok' : ['needs_update','invalid_credentials'].includes(result.status) ? 'needs_update' : 'error', result.message, id);
  return result;
}
