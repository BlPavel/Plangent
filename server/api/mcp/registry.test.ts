import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from './roles.snapshot.json';
import { allowed } from './server';
import { tools, type PlangentTool } from './tools';
import type { AgentSession } from '../../core/agents';

test('module registry preserves every pre-refactoring role tool list and order', () => {
  for (const [profile, expected] of Object.entries(snapshot)) {
    const registered = (Object.keys(tools) as PlangentTool[]).filter(name => profile in tools[name].roles)
      .sort((a, b) => tools[a].roles[profile] - tools[b].roles[profile]);
    assert.deepEqual(registered, expected, profile);
    if (profile === 'committer-full') continue;
    const session = { role: profile.replace('-readonly', ''), policy: profile === 'executor-readonly' ? 'read-only' : 'allow-all',
      metadata: profile === 'branch-review' ? { branch_review: true } : {} } as AgentSession;
    assert.deepEqual(allowed(session), expected.filter(name => name !== 'git_action'), profile);
  }
  assert.deepEqual(allowed({ role: 'task-reviewer', metadata: { branch_review: true } } as unknown as AgentSession), snapshot['task-reviewer']);
});

test('tool requirements and events remain owned by their module', () => {
  for (const tool of Object.values(tools)) {
    for (const required of tool.required) assert.ok(required in tool.fields, required);
    assert.equal(typeof tool.handle, 'function');
  }
  assert.deepEqual(tools.add_task_remark.required, ['scope', 'kind', 'text']);
  assert.deepEqual(tools.save_section.required, ['title', 'description']);
  assert.deepEqual(tools.add_review_remark.required, ['text']);
});
