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
