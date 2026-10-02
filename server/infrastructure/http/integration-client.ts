import { AuthConfig, IntegrationError, requestUrl, requireConnection } from '../../core/integrations';
import { AuthContext, AuthSession, authContext, getSession, clearSession, saveSession, isCurrent, rejectPassword } from '../../core/integrations/sessions';
import { HttpReply, Send, login, strategyFor, matches } from '../../core/integrations/strategies';
import { getDb } from '../db/schema';

/** Use for diagnostics; callers must never log unfiltered request options. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,/authorization|cookie|password|secret|token|body/i.test(k) ? '[REDACTED]' : redact(v)]));
  return value;
}
export class IntegrationHttpError extends IntegrationError {
  constructor(error: IntegrationError, public readonly url: string, public readonly remote_status?: number, public readonly headers?: Headers) { super(error.message,error.code,error.status); }
}
function receiveCookies(session: AuthSession,reply: Response,url: URL): void {
  for (const line of reply.headers.getSetCookie()) {
    const parts = line.split(';'), pair = parts.shift()!, equals = pair.indexOf('=');
    if (equals <= 0) continue;
    const name = pair.slice(0,equals).trim(), value = pair.slice(equals+1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || /[\r\n;]/.test(value)) continue;
    const cookie = { name,value,path: url.pathname.slice(0,url.pathname.lastIndexOf('/')+1) || '/',secure: false,expires: undefined as number | undefined };
    let valid = true;
    for (const part of parts) {
      const [key,...values] = part.trim().split('='), v = values.join('=');
      if (key.toLowerCase() === 'domain' && v.replace(/^\./,'').toLowerCase() !== url.hostname.toLowerCase()) valid = false;
      if (key.toLowerCase() === 'path' && v.startsWith('/')) cookie.path = v;
      if (key.toLowerCase() === 'secure') cookie.secure = true;
      if (key.toLowerCase() === 'expires' && Number.isFinite(Date.parse(v))) cookie.expires = Date.parse(v);
      if (key.toLowerCase() === 'max-age' && /^-?\d+$/.test(v)) cookie.expires = Date.now() + Number(v)*1000;
    }
    if (!valid) continue;
    session.cookies = session.cookies.filter(c => c.name !== name || c.path !== cookie.path);
    if (!cookie.expires || cookie.expires > Date.now()) session.cookies.push(cookie);
  }
}
const send: Send = async (ctx,session,p,options = {}) => {
  if (!isCurrent(ctx)) throw new IntegrationError('Настройки или пароль изменились','configuration_changed',409);
  const c = ctx.connection.auth_config as unknown as AuthConfig;
  let url = requestUrl(ctx.connection.base_url,p), method = options.method ?? 'GET', body = options.body;
  const redirects: string[] = [];
  const timeout = AbortSignal.timeout(c.timeout_ms ?? 15000);
  const signal = options.signal ? AbortSignal.any([timeout,options.signal]) : timeout;
  for (let n = 0; n < 10; n++) {
    ctx.last_url = url;
    let response: Response;
    try {
      response = await fetch(url,{ method,body,headers: { ...c.headers,...options.headers,...strategyFor(session).apply(ctx,session,new URL(url)) },redirect: 'manual',signal });
    } catch { options.signal?.throwIfAborted(); throw new IntegrationHttpError(new IntegrationError('Нет связи с сервисом. VPN подключён?','network',502),url); }
    receiveCookies(session,response,new URL(url));
    const location = response.headers.get('location');
    let responseBody: string;
    try { responseBody = await response.text(); } catch { options.signal?.throwIfAborted(); throw new IntegrationHttpError(new IntegrationError('Ответ сервиса не получен. VPN подключён?','network',502),url); }
    if ([301,302,303,307,308].includes(response.status) && location) {
      const target = new URL(location,url);
      if (target.origin !== ctx.connection.base_url || target.username || target.password) throw new IntegrationHttpError(new IntegrationError('Перенаправление на другой сервис: способ входа не подходит','unsupported_auth',422),url);
      redirects.push(target.href);
      const interim = { status: response.status,headers: response.headers,body: responseBody,url,redirects };
      if (matches(interim,c.invalid_password) || matches(interim,c.invalid_session)) return interim;
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
      url = target.href;
      continue;
    }
    return { status: response.status,headers: response.headers,body: responseBody,url,redirects };
  }
  throw new IntegrationHttpError(new IntegrationError('Слишком много перенаправлений','unsupported_auth',422),url);
};
export async function authenticatedRequest(id: string,p: string,options?: Parameters<Send>[3]): Promise<HttpReply> {
  const connection = requireConnection(id);
  const target = requestUrl(connection.base_url,p);
  let ctx: AuthContext | undefined;
  try {
    ctx = authContext(id);
    const active = ctx, c = ctx.connection.auth_config as unknown as AuthConfig;
    let session = await getSession(ctx,() => login(active,send));
    let reply = await send(ctx,session,p,options);
    if (matches(reply,c.invalid_password)) rejectPassword(ctx);
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
    if (e instanceof IntegrationHttpError) throw e;
    if (e instanceof IntegrationError) throw new IntegrationHttpError(e,ctx?.last_url ?? target);
    throw new IntegrationHttpError(new IntegrationError('Ошибка подключения','remote_error',502),target);
  }
}
export interface ConnectionCheck { ok: boolean; status: string; message: string; url: string; user?: string }
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
  if (result.status !== 'configuration_changed') getDb().prepare(`UPDATE integration_connections SET last_check_status=?,last_check_at=datetime('now'),last_check_message=? WHERE id=?`).run(result.ok ? 'ok' : ['needs_update','invalid_credentials'].includes(result.status) ? 'needs_update' : 'error',result.message,id);
  return result;
}
