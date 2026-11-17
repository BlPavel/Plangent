import test from 'node:test';
import assert from 'node:assert/strict';

test('a conversation the agent never saved starts afresh; other failures are reported', async () => {
  const { conversationLost } = await import('../../../core-services').then(() => import('./acp-host'));
  const rpc = (message: string, code: number, data?: unknown) => Object.assign(new Error(message), { name: 'RequestError', code, data });
  assert.equal(conversationLost(rpc('Resource not found', -32002)), true);
  assert.equal(conversationLost(rpc('Internal error', -32603, { details: 'Resource not found: session' })), true);
  // Codex writes a thread only after its first turn: a restart before it leaves an id with no rollout.
  assert.equal(conversationLost(rpc('Internal error', -32603, { details: 'no rollout found for thread id 01a1e922-da0b-7a83-8e3d-a1bc45e94822' })), true);
  assert.equal(conversationLost(rpc('Internal error', -32603, { details: 'Failure after completion' })), false);
  assert.equal(conversationLost(rpc('Internal error', -32603)), false);
  assert.equal(conversationLost(undefined), false);
});
