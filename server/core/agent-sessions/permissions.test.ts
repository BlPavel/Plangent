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
  for (const command of ['rm -rf test', 'Remove-Item foo -Recurse'])
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
  assert.equal(permissionDecision('allow-all', edit(path.join(root, 'src', 'a.ts')), undefined, { writable: [root] }), 'allow');
  assert.equal(permissionDecision('allow-edits', edit('src/a.ts'), undefined, { writable: [root] }), 'allow');
  assert.equal(permissionDecision('allow-all', edit(path.resolve('repo-typo', 'a.ts')), undefined, { writable: [root] }), 'ask');
  assert.equal(permissionDecision('allow-edits', edit(path.join(root, '..', 'x.ts')), undefined, { writable: [root] }), 'ask');
});
test('a group writes in all its projects, never in reference sources', () => {
  const group = path.resolve('groups', 'g'), shell = path.resolve('shell'), uiKit = path.resolve('libs', 'ui-kit');
  const scope = { writable: [group, shell], readOnly: [uiKit] };
  const edit = (file: string): RequestPermissionRequest => ({ sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: 'edit', title: 'Write', locations: [{ path: file }] } });
  assert.equal(permissionDecision('allow-all', edit(path.join(shell, 'a.ts')), undefined, scope), 'allow');
  assert.equal(permissionDecision('allow-all', edit(path.join(uiKit, 'a.ts')), undefined, scope), 'deny');
  assert.equal(permissionDecision('ask', edit(path.join(uiKit, 'a.ts')), undefined, scope), 'deny');
  assert.equal(permissionDecision('allow-all', edit(path.resolve('other', 'a.ts')), undefined, scope), 'ask');
});
test('edit policy only auto-approves known edit and read operations', () => {
  assert.equal(permissionDecision('allow-edits', request('edit', 'Edit file')), 'allow');
  assert.equal(permissionDecision('allow-edits', request('execute', 'npm test')), 'ask');
  assert.equal(permissionDecision('ask', request('read', 'Read file')), 'ask');
});

test('shell git writes are denied for every role and policy', () => {
  for (const role of [undefined, 'executor', 'reviewer', 'analyst', 'code-fixer', 'librarian', 'planner']) {
    for (const policy of ['ask', 'allow-all', 'allow-edits', 'read-only'] as const) {
      for (const command of ['commit', 'push', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'stash', 'tag', 'cherry-pick', 'am', 'apply --index', 'add', 'pull', 'clean', 'branch new', 'custom-alias']) {
        for (const prefix of ['git ', 'git -C "some repo" ', 'cmd /c git ', '& "C:\\Program Files\\Git\\bin\\git.exe" --literal-pathspecs '])
          assert.equal(permissionDecision(policy, request('execute', prefix + command), undefined, undefined, role), 'deny', prefix + command);
      }
      for (const command of ['status', 'diff', 'log', 'show', 'blame', 'grep'])
        assert.equal(permissionDecision(policy, request('execute', 'git ' + command), undefined, undefined, role), policy === 'allow-all' ? 'allow' : policy === 'read-only' ? 'deny' : 'ask');
    }
  }
  assert.equal(permissionDecision('allow-all', { ...request('execute', 'Run command'), toolCall: { toolCallId: 't', kind: 'execute', rawInput: { command: 'git status && git commit -m x' } } }), 'deny');
  assert.equal(permissionDecision('allow-all', request('execute', 'powershell -Command "git commit -m x"')), 'deny');
  assert.equal(permissionDecision('allow-all', request('execute', 'git status && rm -rf test')), 'ask');
  assert.equal(permissionDecision('allow-all', request('execute', 'git -c alias.x=commit x')), 'deny');
  assert.equal(permissionDecision('allow-all', request('execute', 'git diff --output=patch')), 'deny');
  assert.equal(permissionDecision('allow-all', request('edit', 'Document git commit')), 'allow');
});
