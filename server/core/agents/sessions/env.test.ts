import test from 'node:test';
import assert from 'node:assert/strict';
import { agentEnv, enforceAgentProxy, codexProxyConfig } from './env';

test('loopback bypasses the proxy, the proxy itself is kept', () => {
  const env = agentEnv({ HTTPS_PROXY: 'http://proxy:1' }, { A: '1' });
  assert.equal(env.HTTPS_PROXY, 'http://proxy:1');
  assert.equal(env.A, '1');
  assert.equal(env.NO_PROXY, '127.0.0.1,localhost');
  assert.equal(env.no_proxy, '127.0.0.1,localhost');
});

test('existing NO_PROXY entries are preserved without duplicates', () => {
  const env = agentEnv({ NO_PROXY: 'corp.local, localhost' }, { no_proxy: 'intra' });
  assert.equal(env.NO_PROXY, 'corp.local,localhost,intra,127.0.0.1');
});

test('mandatory proxy replaces inherited routes and bypasses without mutating the parent environment', () => {
  const source = { HTTPS_PROXY: 'http://old:1', https_proxy: 'http://other:2', ALL_PROXY: 'socks5://old:3',
    NO_PROXY: '*', no_proxy: 'api.openai.com,api.anthropic.com', GLOBAL_AGENT_NO_PROXY: '*', A: 'keep' };
  const local = 'http://plangent:temporary@127.0.0.1:1234';
  const result = enforceAgentProxy(agentEnv(source, { HTTPS_PROXY: 'http://project:4' }), local);
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'WS_PROXY', 'WSS_PROXY']) assert.equal(result[key], local);
  assert.equal(result.NO_PROXY, '127.0.0.1,localhost,::1');
  assert.equal(result.no_proxy, result.NO_PROXY);
  assert.equal(result.GLOBAL_AGENT_NO_PROXY, result.NO_PROXY);
  assert.equal(result.NPM_CONFIG_PROXY, local);
  assert.equal(result.NPM_CONFIG_NOPROXY, result.NO_PROXY);
  assert.equal(result.CLAUDE_CODE_PROXY_RESOLVES_HOSTS, '1');
  assert.equal(result.NODE_USE_ENV_PROXY, '1');
  assert.equal(result.A, 'keep');
  assert.equal(source.NO_PROXY, '*', 'commands retain their own parent environment');
  assert.equal(source.https_proxy, 'http://other:2');
});

test('proxied Codex keeps its existing session config and disables alternative system-proxy routes', () => {
  const config = JSON.parse(codexProxyConfig(JSON.stringify({ model_provider: 'company', features: { other: true, respect_system_proxy: true }, 'features.system_proxy_fallback': true })));
  assert.equal(config.model_provider, 'company');
  assert.deepEqual(config.features, { other: true, respect_system_proxy: false, system_proxy_fallback: false });
  assert.equal(config['features.system_proxy_fallback'], false);
  assert.throws(() => codexProxyConfig('[]'));
  assert.throws(() => codexProxyConfig('{"features":"invalid"}'));
});
