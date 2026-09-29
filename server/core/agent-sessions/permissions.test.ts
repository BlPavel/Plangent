import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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
test("Plangent's own tools pass under every policy, lookalikes do not", () => {
  const args = (rawInput: Record<string, unknown>, title = JSON.stringify(rawInput)): RequestPermissionRequest =>
    ({ sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: 'other', title, rawInput } });
  for (const policy of ['ask', 'allow-edits', 'read-only'] as const) {
    assert.equal(permissionDecision(policy, args({ summary: 'done' })), 'allow', policy);
    assert.equal(permissionDecision(policy, args({ verdict: 'approved' })), 'allow', policy);
    assert.equal(permissionDecision(policy, args({})), 'allow', policy);
    assert.equal(permissionDecision(policy, request('other', 'mcp__plangent__complete_step')), 'allow', policy);
  }
  assert.equal(permissionDecision('ask', args({ summary: 'x', command: 'rm' })), 'ask');
  assert.equal(permissionDecision('ask', args({ summary: 'x' }, 'Run shell')), 'ask');
  assert.equal(permissionDecision('read-only', { sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: 'execute', title: '{"summary":"x"}', rawInput: { summary: 'x' } } }), 'deny');
  // Codex names MCP calls "mcp.<server>.<tool>" with { server, tool, arguments } as input.
  assert.equal(permissionDecision('read-only', { sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: 'execute', title: 'mcp.plangent.get_plan', rawInput: { server: 'plangent', tool: 'get_plan', arguments: {} } } }), 'allow');
  assert.equal(permissionDecision('read-only', { sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: 'execute', rawInput: { server: 'other', tool: 'submit_plan', arguments: {} } } }), 'deny');
});
test('automatic approval stops at the project folder', () => {
  const root = path.resolve('repo');
  const edit = (file: string): RequestPermissionRequest => ({ sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: 'edit', title: 'Write',
    locations: [{ path: file }], content: [{ type: 'diff', path: file, oldText: '', newText: 'hi' }] } });
  assert.equal(permissionDecision('allow-all', edit(path.join(root, 'src', 'a.ts')), undefined, root), 'allow');
  assert.equal(permissionDecision('allow-edits', edit('src/a.ts'), undefined, root), 'allow');
  assert.equal(permissionDecision('allow-all', edit(path.resolve('repo-typo', 'a.ts')), undefined, root), 'ask');
  assert.equal(permissionDecision('allow-edits', edit(path.join(root, '..', 'x.ts')), undefined, root), 'ask');
});
test('edit policy only auto-approves known edit and read operations', () => {
  assert.equal(permissionDecision('allow-edits', request('edit', 'Edit file')), 'allow');
  assert.equal(permissionDecision('allow-edits', request('execute', 'npm test')), 'ask');
  assert.equal(permissionDecision('ask', request('read', 'Read file')), 'ask');
});
