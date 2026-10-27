import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('plan author survives materialization, startup and completion; manual saves clear the session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-plan-author-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask } = await import('../tasks');
  const { initQueues } = await import('./queue');
  const { getLatestPlan, updatePlan } = await import('./plans');
  const { submitPlan, materializePlanFile, stopWatchPlanFile, getPlanFilePath } = await import('./plan-file');
  const { initTaskFile } = await import('./task-files-startup');
  initQueues();
  const project = createProject({ name: 'Author', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'AUTHOR' });
  try {
    submitPlan(task, root, '- [ ] First', true, 'planner-one');
    let plan = getLatestPlan(task.id)!;
    const id = plan.id;
    assert.equal(plan.author, 'agent');
    assert.equal(plan.session_id, 'planner-one');
    materializePlanFile(task, plan, root);
    initTaskFile(task);
    assert.equal(getLatestPlan(task.id)!.session_id, 'planner-one');
    submitPlan(task, root, '- [ ] (p1) Revised', true, 'planner-two');
    plan = getLatestPlan(task.id)!;
    assert.equal(plan.id, id);
    assert.equal(plan.session_id, 'planner-two');
    assert.equal(updatePlan(id, plan.content.replace('[ ]', '[x]'), plan)!.session_id, 'planner-two');
    // A real disk edit immediately after Plangent's own write must not be lost to the grace window.
    fs.writeFileSync(getPlanFilePath(root, task.key), plan.content + '\nManual note');
    const deadline = Date.now() + 5000;
    while (getLatestPlan(task.id)!.author !== 'developer') {
      if (Date.now() > deadline) throw new Error('Disk edit was not ingested');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(getLatestPlan(task.id)!.session_id, null);
    submitPlan(task, root, '- [ ] (p1) Again', true, 'planner-three');
    const edited = updatePlan(id, '- [ ] Editor save')!;
    assert.equal(edited.author, 'developer');
    assert.equal(edited.session_id, null);
  } finally { stopWatchPlanFile(task.id); getDb().close(); }
});
