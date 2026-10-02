import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('stdio ACP lifecycle persists coalesced messages, serializes queue, resolves permissions and loads sessions', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-acp-test-'));
  process.env.PLANGENT_DATA_DIR = temp;
  const { getDb } = await import('../../infrastructure/db/schema');
  const repository = await import('./sessions');
  const host = await import('./acp-host');
  const { createAgent } = await import('../agents');
  const { createProject } = await import('../projects');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  repository.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath, acp_args: [path.resolve('scripts/mock-acp-agent.mjs')] });
  const project = createProject({ name: 'Test', repo_path: temp });
  const session = repository.createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  async function until(check: () => boolean) {
    const deadline = Date.now() + 10_000;
    while (!check()) { if (Date.now() > deadline) throw new Error('Timed out: ' + JSON.stringify(host.snapshot(session.id))); await new Promise(r => setTimeout(r, 25)); }
  }
  try {
    await host.sendPrompt(session.id, [{ type: 'text', text: 'x'.repeat(50_000) }]);
    await host.sendPrompt(session.id, [{ type: 'text', text: 'second' }]);
    await until(() => repository.history(session.id).filter(e => e.type === 'turn_end').length === 2);
    assert.deepEqual(repository.history(session.id).filter(e => e.type === 'assistant').map(e => e.payload.text), ['hello world', 'hello world']);
    assert.equal(host.snapshot(session.id).queue.length, 0);
    await host.sendPrompt(session.id, [{ type: 'text', text: 'permission' }]);
    await until(() => host.snapshot(session.id).permissions.length === 1);
    assert.equal(repository.getSession(session.id).status, 'waiting');
    host.answerPermission(session.id, host.snapshot(session.id).permissions[0].permissionId, 'yes');
    await until(() => repository.getSession(session.id).status === 'ready');
    await host.sendPrompt(session.id, [{ type: 'text', text: 'permission' }]);
    await until(() => host.snapshot(session.id).permissions.length === 1);
    await host.cancelSession(session.id);
    await until(() => repository.history(session.id).filter(e => e.type === 'turn_end').length === 4);
    assert.equal(host.snapshot(session.id).permissions.length, 0);
    const count = repository.history(session.id).length;
    await host.closeSession(session.id);
    await host.startSession(session.id);
    assert.equal(repository.history(session.id).length, count);
    const { createApp } = await import('../../infrastructure/http/server');
    const { sessionMcpConfig } = await import('../../infrastructure/mcp/server');
    const { createTask } = await import('../tasks');
    const { createPlan } = await import('../orchestration/plans');
    const { Orchestrator, getOrchestrator } = await import('../orchestration/orchestrator');
    const queues = await import('../orchestration/queue');
    queues.initQueues();
    const { server } = createApp();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.PLANGENT_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    host.configureSessionHost({ mcp: sessionMcpConfig, terminate: killProcessTree });
    try {
      const chatMcp = sessionMcpConfig(session, true)[0] as { url: string; headers: { name: string; value: string }[] };
      const call = async (headers: Record<string, string>, method: string, params = {}) => fetch(chatMcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      assert.equal((await call({}, 'tools/list')).status, 401);
      const headers = Object.fromEntries(chatMcp.headers.map(h => [h.name, h.value]));
      assert.deepEqual((await (await call(headers, 'tools/list')).json() as { result: { tools: unknown[] } }).result.tools, []);
      const denied = await (await call(headers, 'tools/call', { name: 'complete_step', arguments: { summary: 'bad' } })).json() as { error?: unknown; result?: { isError: boolean } };
      assert.ok(denied.error || denied.result?.isError);
      const planTask = createTask({ project_id: project.id, key: 'PLAN-TEST' });
      const planner = repository.createSession({ project_id: project.id, task_id: planTask.id, agent_id: agent.id, role: 'planner', policy: 'read-only', metadata: { briefing: 'BRIEFING' } });
      await host.sendPrompt(planner.id, [{ type: 'text', text: 'plan it' }]);
      const firstUser = repository.history(planner.id).find(e => e.type === 'user')!;
      assert.equal(firstUser.payload.text, 'plan it');
      assert.equal(firstUser.payload.briefing, true);
      const plannerMcp = sessionMcpConfig(planner, true)[0] as { url: string; headers: { name: string; value: string }[] };
      const plannerHeaders = Object.fromEntries(plannerMcp.headers.map(h => [h.name, h.value]));
      const tools = (await (await call(plannerHeaders, 'tools/list')).json() as { result: { tools: { name: string }[] } }).result.tools.map(t => t.name);
      assert.deepEqual(tools, ['get_plan', 'submit_plan']);
      repository.updateSession(planner.id, { status: 'thinking' });
      const empty = await (await call(plannerHeaders, 'tools/call', { name: 'submit_plan', arguments: { content: 'just prose' } })).json() as { result: { isError?: boolean } };
      assert.equal(empty.result.isError, true);
      await call(plannerHeaders, 'tools/call', { name: 'submit_plan', arguments: { content: '# Plan\n- [ ] (p7) Invented id\n- [ ] Second' } });
      const { getLatestPlan } = await import('../orchestration/plans');
      assert.match(getLatestPlan(planTask.id)!.content, /- \[ \] \(p1\) Invented id\n- \[ \] \(p2\) Second/);
      assert.ok(fs.existsSync(path.join(temp, '.plangent', 'PLAN-TEST', 'plan.md')));
      await call(plannerHeaders, 'tools/call', { name: 'submit_plan', arguments: { content: '- [ ] (p1) Invented id\n- [ ] Inserted\n- [x] (p2) Second' } });
      assert.match(getLatestPlan(planTask.id)!.content, /\(p1\) Invented id\n- \[ \] \(p2\) Inserted\n- \[x\] \(p3\) Second/);
      (await import('../orchestration/plan-file')).stopWatchPlanFile(planTask.id);
      const task = createTask({ project_id: project.id, key: 'ACP-TEST' });
      createPlan({ task_id: task.id, content: '- [ ] (p1) First\n- [ ] (p2) Second' });
      const queue = queues.saveQueue(queues.replaceStages(queues.getQueue(task.id, project.id), [
        { sessions: [{ points: ['p1'], agentId: agent.id, reviewerId: agent.id }] },
        { sessions: [{ points: ['p2'], agentId: agent.id }] },
      ]));
      const orch = new Orchestrator(queue);
      await orch.start();
      await until(() => queue.status === 'finished');
      // A finished run moves to the history; the queue is empty for the next one.
      assert.equal(queue.stages.length, 0);
      const ran = queue.history![0].stages.flatMap(st => st.sessions);
      assert.deepEqual(ran.map(s => s.status), ['complete', 'complete']);
      assert.equal(ran[0].reviewRound, 1);
      // The protocol goes as a hidden briefing: the chat shows only the steps.
      const executorFirst = repository.history(ran[0].sessionId!).find(e => e.type === 'user')!;
      assert.equal(executorFirst.payload.briefing, true);
      assert.match(String(executorFirst.payload.text), /^Выполни шаги:\n- p1\. First$/);
      assert.equal(getOrchestrator(task.id), undefined);
      assert.equal(queues.getQueue(task.id, project.id).status, 'finished');

      // Stop keeps finished work and relaunching runs only what is left.
      const stopTask = createTask({ project_id: project.id, key: 'STOP-TEST' });
      createPlan({ task_id: stopTask.id, content: '- [x] (p1) Done\n- [ ] (p2) Pending\n- [ ] (p3) Later' });
      const stopQueue = queues.saveQueue(queues.replaceStages(queues.getQueue(stopTask.id, project.id), [
        { sessions: [{ points: ['p1'], agentId: agent.id }, { points: ['p2'], agentId: agent.id }] },
        { sessions: [{ points: ['p3'], agentId: agent.id }] },
      ]));
      const stopping = new Orchestrator(stopQueue);
      await stopping.start();
      assert.equal(stopQueue.stages[0].sessions[0].status, 'complete');
      await stopping.stop();
      assert.equal(stopQueue.status, 'stopped');
      assert.ok(['stopped', 'complete'].includes(stopQueue.stages[0].sessions[1].status));
      assert.equal(stopQueue.stages[1].sessions[0].status, 'queued');
      assert.equal(getOrchestrator(stopTask.id), undefined);
      for (const s of stopQueue.stages.flatMap(st => st.sessions).filter(s => s.sessionId && s.status === 'stopped')) {
        assert.ok(!['thinking', 'waiting', 'starting'].includes(repository.getSession(s.sessionId!).status));
      }
      (await import('../orchestration/plan-file')).stopWatchPlanFile(task.id);
    } finally { await host.shutdownSessions(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  } finally { await host.shutdownSessions(); getDb().close(); }
});
