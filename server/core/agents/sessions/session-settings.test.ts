import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSessionSettings } from './session-settings';
test('Claude sessions disable attribution and bypass; other adapters keep their settings', () => {
  const base = { id: 'custom', command: 'node', acp_command: 'npx', acp_args: [] as string[] };
  for (const agent of [{ ...base, id: 'agent-claude' }, { ...base, command: 'claude' }, { ...base, acp_args: ['@agentclientprotocol/claude-agent-acp@0.84.0'] }]) {
    const options = agentSessionSettings(agent)._meta!.claudeCode.options;
    assert.deepEqual(options.settings.attribution, { commit: '', pr: '', sessionUrl: false });
    assert.equal(options.settings.includeCoAuthoredBy, false);
    assert.equal(options.allowDangerouslySkipPermissions, false);
  }
  assert.deepEqual(agentSessionSettings(base), {});
});

test('Claude programmatic settings pin the proxy over settings.json without forwarding unrelated secrets', () => {
  const agent = { id: 'agent-claude', command: 'claude', acp_command: '', acp_args: [], use_proxy: true };
  const env = { HTTPS_PROXY: 'http://local:123', https_proxy: 'http://local:123', NO_PROXY: 'localhost', OPENAI_API_KEY: 'private' };
  const options = agentSessionSettings(agent, env)._meta!.claudeCode.options;
  assert.equal(options.settings.env!.HTTPS_PROXY, env.HTTPS_PROXY);
  assert.equal(options.settings.env!.https_proxy, env.https_proxy);
  assert.equal(options.settings.env!.NO_PROXY, '127.0.0.1,localhost,::1');
  assert.equal(options.settings.env!.OPENAI_API_KEY, undefined);
  assert.equal(agentSessionSettings({ ...agent, use_proxy: false }, env)._meta!.claudeCode.options.settings.env, undefined);
});
