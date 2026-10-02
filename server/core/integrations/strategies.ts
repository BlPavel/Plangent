import { randomUUID } from 'node:crypto';
import { AuthConfig, ResponseRule, IntegrationError, relativePath } from './index';
import { AuthContext, AuthSession, rejectPassword } from './sessions';

/** Transport data stays internal: it may include Set-Cookie and response bodies. */
export interface HttpReply { status: number; headers: Headers; body: string; url: string; redirects: string[] }
export type Send = (ctx: AuthContext, session: AuthSession, path: string, options?: { method?: string; headers?: Record<string,string>; body?: string; signal?: AbortSignal }) => Promise<HttpReply>;
export interface LoginStrategy {
  login(ctx: AuthContext, send: Send): Promise<AuthSession>;
  apply(ctx: AuthContext, session: AuthSession, url: URL): Record<string,string>;
  isAuthError(reply: HttpReply, config: AuthConfig): boolean;
}
export function matches(reply: HttpReply, rule: ResponseRule | undefined): boolean {
  if (!rule) return false;
  if (rule.statuses?.includes(reply.status)) return true;
  if (rule.header && reply.headers.get(rule.header.name) === rule.header.value) return true;
  if (rule.html_instead_of_json && (/text\/html/i.test(reply.headers.get('content-type') ?? '') || /^\s*(?:<!doctype html|<html)/i.test(reply.body))) return true;
  if (rule.redirect_path) {
    const pattern = relativePath(rule.redirect_path);
    const regex = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*') + '$');
    if (reply.redirects.some(u => regex.test(new URL(u).pathname))) return true;
  }
  return false;
}
export function isAuthError(reply: HttpReply, config: AuthConfig): boolean {
  return reply.status === 401 || matches(reply,config.invalid_session) || (config.expect_json === true && matches(reply,{ html_instead_of_json: true }));
}
function verify(reply: HttpReply, ctx: AuthContext, allowBasicFallback = false): void {
  const c = ctx.connection.auth_config as unknown as AuthConfig;
  if (matches(reply,c.invalid_password) || (reply.status === 401 && !allowBasicFallback)) rejectPassword(ctx);
  if (reply.status === 403) throw new IntegrationError('Нет прав доступа','forbidden',403);
  if (isAuthError(reply,c) || reply.status < 200 || reply.status >= 300) throw new IntegrationError('Способ входа не подходит','unsupported_auth',422);
}
export const basicStrategy: LoginStrategy = {
  async login(ctx,send) { const session: AuthSession = { id: randomUUID(), strategy: 'basic', cookies: [] }; verify(await send(ctx,session,(ctx.connection.auth_config as unknown as AuthConfig).check_path),ctx,ctx.connection.auth_strategy === 'auto' && (ctx.connection.auth_config as unknown as AuthConfig).strategies?.includes('form') === true); return session; },
  apply(ctx) { return { Authorization: 'Basic ' + Buffer.from(ctx.username + ':' + ctx.password).toString('base64') }; },
  isAuthError,
};
export const formStrategy: LoginStrategy = {
  async login(ctx,send) {
    const c = ctx.connection.auth_config as unknown as AuthConfig;
    const session: AuthSession = { id: randomUUID(), strategy: 'form', cookies: [] };
    const form = new URLSearchParams(c.fields);
    form.set(c.username_field!,ctx.username); form.set(c.password_field!,ctx.password);
    const reply = await send(ctx,session,c.login_path!,{ method: 'POST',headers: { ...c.headers,'Content-Type': 'application/x-www-form-urlencoded' },body: form.toString() });
    if (reply.status === 401 || matches(reply,c.invalid_password)) rejectPassword(ctx);
    if (reply.status === 403) throw new IntegrationError('Нет прав доступа','forbidden',403);
    if (reply.status < 200 || reply.status >= 300 || !session.cookies.length) throw new IntegrationError('Способ входа не подходит','unsupported_auth',422);
    verify(await send(ctx,session,c.check_path),ctx);
    return session;
  },
  apply(_ctx,session,url): Record<string,string> {
    const cookies = session.cookies.filter(c => (!c.secure || url.protocol === 'https:') && (!c.expires || c.expires > Date.now()) && (url.pathname === c.path || url.pathname.startsWith(c.path.endsWith('/') ? c.path : c.path + '/')));
    return cookies.length ? { Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ') } : {};
  },
  isAuthError,
};
export function strategyFor(session: AuthSession): LoginStrategy { return session.strategy === 'basic' ? basicStrategy : formStrategy; }
export async function login(ctx: AuthContext,send: Send): Promise<AuthSession> {
  const c = ctx.connection.auth_config as unknown as AuthConfig;
  const list = ctx.connection.auth_strategy === 'auto' ? c.strategies! : [ctx.connection.auth_strategy];
  for (const s of list) {
    if (s !== 'basic' && s !== 'form') throw new IntegrationError('Этот способ входа пока не поддерживается','unsupported_auth',422);
    try { return await (s === 'basic' ? basicStrategy : formStrategy).login(ctx,send); }
    catch (e) { if (!(e instanceof IntegrationError) || e.code !== 'unsupported_auth') throw e; }
  }
  throw new IntegrationError('Ни один настроенный способ входа не подходит','unsupported_auth',422);
}
