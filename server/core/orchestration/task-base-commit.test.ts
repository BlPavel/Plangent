import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('task baseline captures HEAD once, resets explicitly and stays empty without git', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-task-base-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask } = await import('../tasks');
  const { captureTaskBaseCommit } = await import('../tasks/base-commit');
  const { repositoryInfo } = await import('../code/git');
  try {
    const plain = createProject({ name: 'No git', repo_path: root });
    const empty = createTask({ project_id: plain.id, key: 'EMPTY' });
    assert.equal((await captureTaskBaseCommit(empty.id)).base_commit, null);
    await assert.rejects(captureTaskBaseCommit(empty.id, true), /коммита/);
    // Read the existing checkout only: this test never creates branches or commits.
    const head = (await repositoryInfo(process.cwd()))?.head;
    assert.ok(head, 'Run this test from the project checkout');
    const project = createProject({ name: 'Checkout', repo_path: process.cwd() });
    const task = createTask({ project_id: project.id, key: 'BASE' });
    assert.equal((await captureTaskBaseCommit(task.id)).base_commit, head);
    assert.equal((await captureTaskBaseCommit(task.id)).base_commit, head);
    const previous = '0'.repeat(40);
    getDb().prepare('UPDATE tasks SET base_commit=? WHERE id=?').run(previous, task.id);
    assert.equal((await captureTaskBaseCommit(task.id)).base_commit, previous);
    assert.equal((await captureTaskBaseCommit(task.id, true)).base_commit, head);
    const next = createTask({ project_id: project.id, key: 'NEXT' });
    assert.equal((await captureTaskBaseCommit(next.id)).base_commit, head);
  } finally { getDb().close(); }
});
