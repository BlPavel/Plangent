import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

test('real plan saves drive subscription, including deleted/reused ids; HTTP enforces scope and origin', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-plan-review-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask } = await import('../tasks');
  const { initQueues } = await import('../orchestration/queue');
  const { submitPlan, stopWatchPlanFile } = await import('../orchestration/plan-file');
  const { getLatestPlan, updatePlan, createPlan } = await import('../orchestration/plans');
  const { planReviews } = await import('./index');
  const { planReviewRouter } = await import('../../infrastructure/http/routes/plan-review');
  initQueues();
  const project = createProject({ name: 'Review', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'REVIEW' });
  const service = planReviews();
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/tasks/:taskId/plan-reviews', planReviewRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const url = base + '/api/projects/' + project.id + '/tasks/' + task.id + '/plan-reviews';
  const request = async (suffix: string, method = 'GET', body?: unknown, headers: Record<string,string> = {}) =>
    fetch(url + suffix, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    submitPlan(task, root, '- [ ] First\n- [ ] Second\n- [ ] Third', true, 'planner');
    const opened = await request('', 'POST');
    assert.equal(opened.status, 201);
    const reviewId = ((await opened.json()) as { review: { id: string } }).review.id;
    const remark = service.addRemark(project.id,task.id,reviewId,{ steps: ['p2','p3'], kind: 'order', text: 'Change these' });
    // Deleting p2 and shifting p3 to p2 must keep the two references distinguishable.
    submitPlan(task, root, '- [ ] (p1) First\n- [ ] (p3) Third', true, 'planner');
    let read = service.detail(project.id,task.id,reviewId);
    assert.deepEqual(read.remarks[0].steps, [{ id: 'p2', deleted: true }, { id: 'p2', deleted: false }]);
    assert.equal(read.remarks[0].outdated, true);
    assert.ok(read.review.plan_content.includes('Second'));
    const accepted = await request('/' + reviewId + '/remarks/' + remark.id + '/decision', 'PUT', { status: 'accepted', comment: 'Please fix' });
    assert.equal(accepted.status, 200);
    service.sent(project.id,task.id,reviewId,[remark.id],'planner');
    submitPlan(task, root, '- [ ] (p1) First\n- [ ] (p2) Third revised', true, 'planner');
    read = service.detail(project.id,task.id,reviewId);
    assert.equal(read.remarks[0].status, 'applied');
    const second = service.create(project.id,task.id).review;
    const stale = service.addRemark(project.id,task.id,second.id,{ steps: ['p2'], kind: 'unclear', text: 'Clarify' });
    const plan = getLatestPlan(task.id)!;
    updatePlan(plan.id, plan.content.replace('Third revised','Manual edit'));
    assert.equal(service.detail(project.id,task.id,second.id).remarks[0].outdated, true);
    const third = service.create(project.id,task.id).review;
    service.addRemark(project.id,task.id,third.id,{ steps: ['p1'], kind: 'risk', text: 'Risk' });
    createPlan({ task_id: task.id, content: '- [ ] (p1) Replaced', author: 'developer' });
    assert.equal(service.detail(project.id,task.id,third.id).remarks[0].outdated, true);
    assert.equal((await request('/' + reviewId)).status, 200);
    assert.equal((await request('/missing')).status, 404);
    assert.equal((await request('/' + reviewId + '/remarks/' + remark.id + '/messages','POST',{ text: 'Question' })).status, 200);
    assert.equal((await request('/' + second.id + '/remarks/' + stale.id + '/decision','PUT',{ status: 'discussing' })).status, 400);
    assert.equal((await request('', 'POST', {}, { origin: 'https://untrusted.example' })).status, 403);
    const foreign = url.replace(task.id, 'missing');
    assert.equal((await fetch(foreign)).status, 404);
    // A deleted last step replaced by a new one at the same number has no nonidentity idMap.
    submitPlan(task, root, '- [ ] (p1) First\n- [ ] Second', true, 'planner');
    const fourth = service.create(project.id,task.id).review;
    service.addRemark(project.id,task.id,fourth.id,{ steps: ['p2'], kind: 'risk', text: 'Old second' });
    submitPlan(task, root, '- [ ] (p1) First\n- [ ] New second', true, 'planner');
    assert.equal(service.detail(project.id,task.id,fourth.id).remarks[0].steps[0].deleted, true);
  } finally {
    stopWatchPlanFile(task.id);
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    getDb().close();
    // Do not remove the temporary directory: library bootstrap may still be finishing asynchronous writes.
  }
});
