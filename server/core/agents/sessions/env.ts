type Env = Record<string, string | undefined>;
import { agentProxyUrl } from '../../settings';

/** Applied last, after every project/workspace override. No remote proxy credentials in child env. */
export function enforceAgentProxy(env: Env, url: string): Env {
  const result = { ...env };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'WS_PROXY', 'WSS_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY', 'GLOBAL_AGENT_HTTPS_PROXY', 'CLAUDE_CODE_HTTP_PROXY', 'CLAUDE_CODE_HTTPS_PROXY',
    'npm_config_proxy', 'npm_config_https_proxy']) {
    result[key] = url; result[key.toLowerCase()] = url; result[key.toUpperCase()] = url;
  }
  for (const key of ['NO_PROXY', 'GLOBAL_AGENT_NO_PROXY', 'npm_config_noproxy']) {
    result[key] = '127.0.0.1,localhost,::1'; result[key.toLowerCase()] = result[key]; result[key.toUpperCase()] = result[key];
  }
  result.NODE_USE_ENV_PROXY = '1';
  result.CLAUDE_CODE_PROXY_RESOLVES_HOSTS = '1';
  // Keep optional agent telemetry out of the corporate connection.
  result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  result.DISABLE_TELEMETRY = '1';
  result.DISABLE_ERROR_REPORTING = '1';
  return result;
}

export async function resolvedAgentEnv(agent: { use_proxy?: boolean; env: Env; id?: string; command?: string; acp_command?: string; acp_args?: string[] }, ...layers: (Env | undefined)[]): Promise<Env> {
  const env = agentEnv(process.env, agent.env, ...layers);
  if (!agent.use_proxy) return env;
  const result = enforceAgentProxy(env, await agentProxyUrl());
  if (/codex/i.test([agent.id, agent.command, agent.acp_command, ...(agent.acp_args ?? [])].join(' '))) {
    result.CODEX_CONFIG = codexProxyConfig(result.CODEX_CONFIG);
  }
  return result;
}

/** Keep the adapter's explicit route above system-proxy/PAC opt-ins in the native runtime. */
export function codexProxyConfig(value?: string): string {
  const config: unknown = value ? JSON.parse(value) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('CODEX_CONFIG должен быть JSON-объектом');
  const settings = config as Record<string, unknown>;
  const features = settings.features;
  if (features !== undefined && (!features || typeof features !== 'object' || Array.isArray(features))) throw new Error('CODEX_CONFIG.features должен быть JSON-объектом');
  return JSON.stringify({ ...settings, features: { ...(features as object | undefined), respect_system_proxy: false, system_proxy_fallback: false },
    'features.respect_system_proxy': false, 'features.system_proxy_fallback': false });
}

/**
 * Agent env with loopback excluded from any configured proxy: the Plangent MCP server lives on 127.0.0.1,
 * and clients that honor HTTP_PROXY (Codex) would otherwise send it to the remote proxy and fail.
 * External traffic keeps going through the proxy.
 */
export function agentEnv(...layers: (Env | undefined)[]): Env {
  const env: Env = Object.assign({}, ...layers);
  const current = [env.NO_PROXY, env.no_proxy].filter(Boolean).join(',').split(',').map(s => s.trim()).filter(Boolean);
  const noProxy = [...new Set([...current, '127.0.0.1', 'localhost'])].join(',');
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return env;
}
