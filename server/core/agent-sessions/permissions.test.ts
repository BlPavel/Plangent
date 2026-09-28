import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionDecision } from './permissions';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
const request = (kind: string, title: string): RequestPermissionRequest => ({ sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: kind as 'execute', title } });
test('read-only rejects writes and commands even when disguised as read tools', () => {
  assert.equal(permissionDecision('read-only', request('edit', 'update file')), 'deny');
  assert.equal(permissionDecision('read-only', request('execute', 'npm test')), 'deny');
  assert.equal(permissionDecision('read-only', request('read', 'Read file')), 'allow');
});
test('automatic approval retains dangerous-command interception', () => {
  for (const command of ['git push --force origin main', 'git push -f', 'git reset --hard', 'rm -rf test', 'Remove-Item foo -Recurse'])
    assert.equal(permissionDecision('allow-all', request('execute', command)), 'ask', command);
  assert.equal(permissionDecision('allow-all', request('execute', 'npm test')), 'allow');
  assert.equal(permissionDecision('allow-all', request('execute', 'deploy prod'), ['deploy prod']), 'ask');
});
test('edit policy only auto-approves known edit and read operations', () => {
  assert.equal(permissionDecision('allow-edits', request('edit', 'Edit file')), 'allow');
  assert.equal(permissionDecision('allow-edits', request('execute', 'npm test')), 'ask');
  assert.equal(permissionDecision('ask', request('read', 'Read file')), 'ask');
});
