import { IntegrationError, requestUrl } from './config';
import type { AuthConfig, AuthContext, AuthSession } from '../../models/http-client';
import { type Send, strategyFor, matches } from './strategies';
/** Use for diagnostics; callers must never log unfiltered request options. */
export function redact(value: unknown, secretHeaders: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map(entry => redact(entry, secretHeaders));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,/authorization|cookie|password|secret|token|body/i.test(k) || secretHeaders.some(header => header.toLowerCase() === k.toLowerCase()) ? '[REDACTED]' : redact(v, secretHeaders)]));
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
export const createSend = (isCurrent: (ctx: AuthContext) => boolean): Send => async (ctx,session,p,options = {}) => {
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
