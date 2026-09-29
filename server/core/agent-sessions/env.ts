type Env = Record<string, string | undefined>;

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
