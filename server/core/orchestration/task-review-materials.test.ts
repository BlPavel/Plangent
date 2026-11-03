import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('task review brief includes only ready architecture and QA, with decision references', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-review-materials-'));
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask } = await import('../tasks');
  const { createAgent } = await import('../agents');
  const { createSession, initSessions } = await import('../agent-sessions/sessions');
  const { initQueues } = await import('./queue');
  const { saveMaterial } = await import('../materials');
  const { markPreparationStage } = await import('../materials/stages');
  const { taskReviewBrief, TASK_REVIEW_PROTOCOL } = await import('./task-review');
  const { stopWatchAnalysis } = await import('./task-files');
  initSessions(); initQueues();
  const project = createProject({ name: 'Review materials', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'REVIEW-MATERIALS' });
  const agent = createAgent({ name: 'Review test', command: process.execPath });
  const session = createSession({ project_id: project.id, task_id: task.id,
    agent_id: agent.id, role: 'task-reviewer', policy: 'read-only',
    metadata: { task_review_independent: true, task_review_active: true, task_review_changes: null } });
  try {
    const empty = await taskReviewBrief(session);
    assert.equal(empty.architecture, null);
    assert.equal(empty.qa, null);
    assert.equal(empty.changes, null);
    assert.ok(empty.limitation);
    const architecture = saveMaterial({ task_id: task.id, type: 'architecture', content: '**D1** Keep domain logic separate' });
    const qa = saveMaterial({ task_id: task.id, type: 'qa', content: '**Q3** Reject invalid input' });
    const draft = await taskReviewBrief(session);
    assert.equal(draft.architecture, null);
    assert.equal(draft.qa, null);
    markPreparationStage(task.id, 'architecture', 'ready');
    markPreparationStage(task.id, 'qa', 'ready');
    const ready = await taskReviewBrief(session);
    assert.deepEqual(ready.architecture, architecture);
    assert.deepEqual(ready.qa, qa);
    assert.deepEqual(ready.protocol.slice(0, TASK_REVIEW_PROTOCOL.length), TASK_REVIEW_PROTOCOL);
    assert.match(ready.protocol.at(-1)!, /even without tests/);
    assert.match(ready.protocol.at(-1)!, /\[\[architecture#D1\]\]/);
    assert.match(ready.protocol.at(-1)!, /\[\[qa#Q3\]\]/);
    markPreparationStage(task.id, 'architecture', 'skipped');
    markPreparationStage(task.id, 'qa', 'skipped');
    const skipped = await taskReviewBrief(session);
    assert.equal(skipped.architecture, null);
    assert.equal(skipped.qa, null);
  } finally {
    stopWatchAnalysis(task.id);
    getDb().close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
