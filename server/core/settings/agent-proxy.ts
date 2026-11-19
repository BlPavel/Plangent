import * as queries from '../../infrastructure/db/repositories/settings';
import { X509Certificate } from 'node:crypto';
import { getSecretVault } from '../../infrastructure/secrets';
import { AgentProxyBridge } from '../../infrastructure/agent-proxy/bridge';
import { connectThroughProxy } from '../../infrastructure/agent-proxy/tunnel';
import type { AgentProxySettings, AgentProxyCheck, ProxyConnection } from '../../models/agent-proxy';

const KEY = 'agent-proxy';
interface StoredProxy { url: string; username: string; secret: string; ca?: string }
const bridge = new AgentProxyBridge();
let signature = '';

function stored(): StoredProxy {
  const row = queries.rowSelectAppSettings(KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as StoredProxy : { url: '', username: '', secret: '' };
}
export function agentProxySettings(): AgentProxySettings {
  const value = stored();
  return { url: value.url, username: value.username, hasPassword: Boolean(value.secret), ...(value.ca ? { ca: value.ca } : {}) };
}
function connection(value = stored()): ProxyConnection {
  if (!value.url) throw new Error('Для агента включён прокси. Сначала настройте его в «Настройки → Прокси».');
  return { url: value.url, username: value.username, ...(value.ca ? { ca: value.ca } : {}),
    password: value.secret ? getSecretVault().decrypt(Buffer.from(value.secret, 'base64')) : '' };
}

export function saveAgentProxy(input: unknown): AgentProxySettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Некорректные настройки прокси');
  const body = input as Record<string, unknown>;
  if (typeof body.url !== 'string' || (body.username !== undefined && typeof body.username !== 'string')
    || (body.password !== undefined && typeof body.password !== 'string')
    || (body.ca !== undefined && typeof body.ca !== 'string')) throw new Error('Адрес, логин, пароль и сертификат должны быть строками');
  let url = body.url.trim(), username = body.username as string | undefined, password = body.password as string | undefined;
  const previous = stored();
  const ca = url ? ((body.ca as string | undefined) ?? previous.ca ?? '').trim() : '';
  if (ca) {
    try {
      const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      if (ca.length > 65536 || !certificates.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim()) throw new Error();
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch { throw new Error('Укажите сертификат CA в формате PEM, без закрытого ключа'); }
  }
  if (url) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Укажите адрес с протоколом: http://, https:// или socks5://'); }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname
      || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Поддерживаются HTTP, HTTPS и SOCKS5: укажите только сервер и порт');
    try {
      if (!username) username = decodeURIComponent(parsed.username);
      if (parsed.password) password ??= decodeURIComponent(parsed.password);
    } catch { throw new Error('Некорректные учётные данные прокси'); }
    parsed.username = ''; parsed.password = ''; parsed.pathname = '';
    url = parsed.toString().replace(/\/$/, '');
    if (/[\r\n\0]/.test(username ?? '') || (password !== undefined && /[\r\n\0]/.test(password))) throw new Error('Некорректные учётные данные прокси');
    if (parsed.protocol.startsWith('socks') && (Buffer.byteLength(username ?? '') > 255 || Buffer.byteLength(password ?? '') > 255))
      throw new Error('Логин и пароль SOCKS5 не должны превышать 255 байт');
  } else { username = ''; password = ''; }
  const keep = url === previous.url && username === previous.username;
  const secret = password === undefined ? (keep ? previous.secret : '')
    : password ? getSecretVault().encrypt(password).toString('base64') : '';
  const value: StoredProxy = { url, username: username ?? '', secret, ...(ca ? { ca } : {}) };
  const upstream = value.url ? connection(value) : null;
  queries.writeSettingInsertAppSettings(KEY, JSON.stringify(value));
  // Closing old tunnels is synchronous. A removed proxy must stop existing connections too.
  bridge.configure(upstream);
  signature = JSON.stringify(value);
  return agentProxySettings();
}

/** Returns only a local gateway URL: remote proxy credentials stay in the server. */
export async function agentProxyUrl(): Promise<string> {
  const value = stored(), key = JSON.stringify(value);
  const upstream = connection(value); // A missing/unreadable secret blocks launch, never connects directly.
  if (key !== signature) { bridge.configure(upstream); signature = key; }
  return bridge.url();
}
export async function checkAgentProxy(): Promise<AgentProxyCheck> {
  const config = connection();
  const results = await Promise.all(['api.openai.com', 'api.anthropic.com'].map(async host => {
    try {
      const socket = await connectThroughProxy(config, host, 443);
      socket.destroy();
      return { host, ok: true };
    } catch (error) { return { host, ok: false, error: (error as Error).message }; }
  }));
  return { ok: results.every(result => result.ok), results };
}
export async function shutdownAgentProxy(): Promise<void> { signature = ''; await bridge.close(); }
