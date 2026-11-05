import test from 'node:test';
import assert from 'node:assert/strict';
import { idleDeadline, idleTimeout, CHAT_IDLE_MS, COMPLETED_WORK_IDLE_MS } from './idle-policy';

test('only finished execution and document review work receives the one-minute deadline', () => {
  for (const role of ['executor', 'task-reviewer', 'plan-reviewer'] as const) {
    assert.equal(idleTimeout({ role, metadata: {} }), CHAT_IDLE_MS);
    assert.equal(idleTimeout({ role, metadata: { workFinishedAt: 100 } }), COMPLETED_WORK_IDLE_MS);
    assert.equal(idleDeadline({ role, metadata: { workFinishedAt: 100 } }, 200), 60_200);
    assert.equal(idleDeadline({ role, metadata: { workFinishedAt: 200 } }, 100), 60_200);
  }
  for (const role of ['chat', 'task-chat', 'planner', 'analyst', 'material-author', 'code-fixer', 'errand'] as const)
    assert.equal(idleTimeout({ role, metadata: { workFinishedAt: 100 } }), CHAT_IDLE_MS);
});

