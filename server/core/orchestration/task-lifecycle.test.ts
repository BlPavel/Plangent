import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

test('done closes task agents, preserves documents/history and reopen restores files and chats', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-task-lifecycle-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask, getTask } = await import('../tasks');
  const { createAgent } = await import('../agents');
  const { createPlan, getLatestPlan } = await import('./plans');
  const { createRun, getRun } = await import('../runs');
  const repository = await import('../agent-sessions/sessions');
  const host = await import('../agent-sessions/acp-host');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  const queues = await import('./queue');
  const { Orchestrator } = await import('./orchestrator');
  const analysis = await import('./analysis');
  const taskFiles = await import('./task-files');
  const { materializePlanFile } = await import('./plan-file');
  const { orchestratorRouter } = await import('../../infrastructure/http/routes/orchestrator');
  const { runsRouter } = await import('../../infrastructure/http/routes/runs');
  const { plansRouter } = await import('../../infrastructure/http/routes/plans');
  const { analysisRouter } = await import('../../infrastructure/http/routes/analysis');
  const { agentSessionsRouter } = await import('../../infrastructure/http/routes/agent-sessions');
  repository.initSessions();
  queues.initQueues();
  const terminated: number[] = [];
  host.configureSessionHost({ mcp: () => [], terminate: async pid => { terminated.push(pid!); await killProcessTree(pid); } });
  const agent = createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('scripts/mock-acp-agent.mjs')] });
  const project = createProject({ name: 'Lifecycle', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'LIFE' });
  const other = createTask({ project_id: project.id, key: 'OTHER' });
  const section = analysis.createAnalysisSection({ task_id: task.id, title: 'API', description: 'Material' });
  const file = analysis.addAnalysisFile(section.id, { name: 'api.txt', mime: 'text/plain', content: Buffer.from('API') });
  const plan = createPlan({ task_id: task.id, content: '- [x] (p1) Already done\n- [ ] (p2) Execute [[' + section.slug + '/api.txt]]' });
  materializePlanFile(task, plan, root);
  const chats = [];
  for (const role of ['planner', 'analyst'] as const) {
    const run = createRun({ task_id: task.id, agent_id: agent.id, agent_name: agent.name });
    const chat = repository.createSession({ project_id: project.id, task_id: task.id, run_id: run.id,
      agent_id: agent.id, role, policy: 'read-only' });
    repository.addEvent(chat.id, 'user', { text: 'Keep history' });
    repository.addEvent(chat.id, 'assistant', { text: 'Saved response' });
    await host.startSession(chat.id);
    chats.push({ chat, run, history: repository.history(chat.id) });
  }
  const foreign = repository.createSession({ project_id: project.id, task_id: other.id, agent_id: agent.id, role: 'analyst', policy: 'read-only' });
  await host.startSession(foreign.id);
  const foreignPid = (await host.startSession(foreign.id)).process.pid!;
  const queue = queues.getQueue(task.id, project.id);
  queue.stages = [{ id: 'stage', pauseAfter: false, sessions: [{ id: 'exec', points: ['p2'], agentId: agent.id,
    queueMode: 'execute', permissionPolicy: 'ask', status: 'queued' }] }];
  const orch = new Orchestrator(queue);
  await orch.start();
  const executing = queue.stages[0].sessions[0];
  assert.ok(executing.sessionId);
  const app = express();
  app.use(express.json());
  const route = '/api/projects/:projectId/tasks/:taskId';
  app.use(route, orchestratorRouter);
  app.use(route + '/plans', plansRouter);
  app.use(route + '/runs', runsRouter);
  app.use(route + '/analysis', analysisRouter);
  app.use('/api/agent-sessions', agentSessionsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const base = origin + '/api/projects/' + project.id + '/tasks/' + task.id;
  const post = (url: string, data = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.equal((await post(base.replace(project.id, 'wrong') + '/done')).status, 404);
    const before = getLatestPlan(task.id)!.content;
    const done = await post(base + '/done');
    assert.equal(done.status, 200);
    assert.equal(getTask(task.id)!.status, 'done');
    assert.equal(queues.getQueue(task.id, project.id).status, 'stopped');
    assert.equal(fs.existsSync(taskFiles.getTaskDirectory(root, task.key)), false);
    assert.equal(getLatestPlan(task.id)!.content, before);
    assert.equal(analysis.getAnalysisFile(file.id)!.content.toString(), 'API');
    for (const { chat, run, history } of chats) {
      assert.equal(repository.getSession(chat.id).status, 'ready');
      assert.deepEqual(repository.history(chat.id), history);
      assert.equal(getRun(run.id)!.status, 'interrupted');
      assert.equal(host.snapshot(chat.id).streaming, null);
      assert.equal((await post(origin + '/api/agent-sessions/' + chat.id + '/prompt', { text: 'Forbidden' })).status, 409);
      assert.equal((await post(origin + '/api/agent-sessions/' + chat.id + '/retry')).status, 409);
    }
    assert.equal(terminated.length, 3);
    assert.equal(terminated.includes(foreignPid), false);
    assert.equal((await post(base + '/runs', { purpose: 'analysis', agent_id: agent.id })).status, 409);
    assert.equal((await post(base + '/queue/start')).status, 409);
    assert.equal((await post(base + '/plans', { content: 'Forbidden' })).status, 409);
    const document = await fetch(base + '/analysis/' + section.id + '/files/' + file.id);
    assert.equal(await document.text(), 'API');
    assert.equal((await post(base + '/reopen')).status, 200);
    assert.equal(getTask(task.id)!.status, 'in_progress');
    assert.ok(fs.existsSync(taskFiles.getPlanFilePath(root, task.key)));
    const restored = path.join(taskFiles.getAnalysisDirectory(root, task.key), section.slug, file.name);
    assert.equal(fs.readFileSync(restored, 'utf8'), 'API');
    assert.equal(queues.getQueue(task.id, project.id).stages[0].sessions[0].sessionId, executing.sessionId);
    for (const { chat, history } of chats) {
      assert.deepEqual(repository.history(chat.id), history);
      const state = await host.startSession(chat.id);
      assert.ok(state.process.pid);
      await host.closeSession(chat.id);
    }
  } finally {
    await orch.stop();
    await host.shutdownSessions();
    await new Promise<void>(resolve => server.close(() => resolve()));
    taskFiles.deleteTaskDirectory(task, root);
    taskFiles.deleteTaskDirectory(other, root);
    getDb().close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
