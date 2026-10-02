import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { WebSocket } from 'ws';
import { once } from 'node:events';

test('analysis HTTP CRUD, uploads, ownership, deletion warnings and events', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-analysis-http-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask, updateTask } = await import('../tasks');
  const { createPlan } = await import('./plans');
  const { initQueues, getQueue, saveQueue } = await import('./queue');
  const { analysisRouter } = await import('../../infrastructure/http/routes/analysis');
  const { addEventsClient } = await import('../shared/events');
  const analysis = await import('./analysis');
  const taskFiles = await import('./task-files');
  initQueues();
  const project = createProject({ name: 'HTTP', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'HTTP' });
  const other = createTask({ project_id: project.id, key: 'OTHER' });
  const app = express();
  app.use('/api/projects/:projectId/tasks/:taskId/analysis', analysisRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const base = 'http://127.0.0.1:' + address.port + '/api/projects/' + project.id + '/tasks/' + task.id + '/analysis';
  const events: Record<string, unknown>[] = [];
  const socket = { readyState: WebSocket.OPEN, on() {}, send(data: string) { events.push(JSON.parse(data)); } };
  addEventsClient(socket as unknown as WebSocket);
  async function request(url: string, method = 'GET', data?: unknown) {
    return fetch(base + url, { method, headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data) });
  }
  try {
    const created = await request('', 'POST', { title: 'API', description: 'Initial', author: 'agent' });
    assert.equal(created.status, 201);
    const section = await created.json() as { id: string; slug: string; author: string };
    assert.equal(section.author, 'developer');
    assert.equal(events.at(-1)!.actor, 'developer');
    const foreign = analysis.createAnalysisSection({ task_id: other.id, title: 'Other' });
    assert.equal((await request('/' + foreign.id)).status, 404);
    const wrongProject = await fetch(base.replace(project.id, 'wrong'));
    assert.equal(wrongProject.status, 404);
    for (const data of [null, [], { title: '' }, { title: 'X', kind: 'invalid' }])
      assert.equal((await request('', 'POST', data)).status, 400);
    assert.equal((await request('/' + section.id, 'PATCH', { description: null })).status, 400);
    assert.equal((await request('/reorder', 'POST', { ids: [] })).status, 400);
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=', 'base64');
    const uploaded = await request('/' + section.id + '/files', 'POST', {
      name: 'картинка.png', data: 'data:image/png;base64,' + bytes.toString('base64'),
    });
    assert.equal(uploaded.status, 201);
    const file = await uploaded.json() as { id: string; name: string; content?: unknown };
    assert.equal(file.content, undefined);
    const fileUrl = '/' + section.id + '/files/' + file.id;
    const image = await request(fileUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.match(image.headers.get('content-disposition')!, /inline; filename\*=UTF-8''%/);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
    assert.match((await request(fileUrl + '?download=true')).headers.get('content-disposition')!, /^attachment/);
    assert.equal((await request('/' + foreign.id + '/files/' + file.id)).status, 404);
    for (const data of [
      { name: 'bad', data: '!!!' }, { name: '../bad', data: '' },
      { name: 'bad', data: 'data:image/png,abc' }, { name: 'bad', data: '', mime: 'image/png\r\nBAD' },
    ]) assert.equal((await request('/' + section.id + '/files', 'POST', data)).status, 400);
    const oversized = Buffer.alloc(analysis.MAX_ANALYSIS_FILE_SIZE + 1).toString('base64');
    assert.equal((await request('/' + section.id + '/files', 'POST', { name: 'large', data: oversized })).status, 413);
    const patched = await request('/' + section.id, 'PATCH', { title: 'Renamed', description: 'Edited', kind: 'worked' });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json() as { slug: string }).slug, section.slug);
    const toc = fs.readFileSync(path.join(taskFiles.getAnalysisDirectory(root, task.key), 'README.md'), 'utf8');
    assert.ok(toc.indexOf('Renamed') > toc.indexOf('## Обработанные'));
    const secondResponse = await request('', 'POST', { title: 'Second' });
    const second = await secondResponse.json() as { id: string };
    assert.equal((await request('/reorder', 'POST', { ids: [second.id, section.id] })).status, 200);
    const listing = await (await request('')).json() as { id: string; files: { content?: unknown }[] }[];
    assert.equal(listing[0].id, second.id);
    assert.equal(listing[1].files[0].content, undefined);
    const plan = createPlan({ task_id: task.id, content:
      '- [ ] (p1) Read [[' + section.slug + '/' + file.name + ']]\n- [ ] (p2) Read [[' + section.slug + ']]' });
    assert.ok(plan);
    const warning = await request(fileUrl, 'DELETE');
    assert.equal(warning.status, 409);
    const detail = await warning.json() as { confirmation_required: boolean; references: { id: string }[] };
    assert.equal(detail.confirmation_required, true);
    assert.deepEqual(detail.references.map(s => s.id), ['p1']);
    assert.equal((await request('/' + section.id, 'DELETE')).status, 409);
    assert.ok(analysis.getAnalysisFile(file.id));
    updateTask(task.id, { status: 'done' });
    assert.deepEqual(Buffer.from(await (await request(fileUrl)).arrayBuffer()), bytes);
    assert.equal((await request('/' + section.id, 'PATCH', { title: 'Closed' })).status, 409);
    assert.equal((await request(fileUrl + '?confirm=true', 'DELETE')).status, 409);
    updateTask(task.id, { status: 'open' });
    const queue = getQueue(task.id, project.id);
    queue.status = 'running';
    queue.stages = [{ id: 'stage', pauseAfter: false, sessions: [
      { id: 'active', points: ['p1'], agentId: 'agent-codex', queueMode: 'execute', permissionPolicy: 'ask', status: 'running' },
    ] }];
    saveQueue(queue, false);
    assert.equal((await request('/' + section.id, 'PATCH', { title: 'Blocked' })).status, 409);
    queue.status = 'paused';
    saveQueue(queue, false);
    assert.equal((await request(fileUrl + '?confirm=true', 'DELETE')).status, 204);
    assert.equal((await request(fileUrl)).status, 404);
    assert.equal((await request('/' + section.id + '?confirm=true', 'DELETE')).status, 204);
    assert.equal((await request('/' + second.id, 'DELETE')).status, 204);
    const agentSection = analysis.createAnalysisSection({ task_id: task.id, title: 'Agent', author: 'agent' });
    assert.equal(events.at(-1)!.actor, 'agent');
    analysis.updateAnalysisSection(agentSection.id, { description: 'Agent edit' }, 'agent');
    assert.equal(events.at(-1)!.actor, 'agent');
    assert.equal(events.at(-1)!.taskId, task.id);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    taskFiles.stopWatchAnalysis(task.id);
    taskFiles.stopWatchAnalysis(other.id);
    getDb().close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
