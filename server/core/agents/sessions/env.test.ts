import test from 'node:test';
import assert from 'node:assert/strict';
import { agentEnv } from './env';

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
