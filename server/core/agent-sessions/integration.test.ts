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
    const { Orchestrator } = await import('../orchestration/orchestrator');
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
      const task = createTask({ project_id: project.id, key: 'ACP-TEST' });
      createPlan({ task_id: task.id, content: '- [ ] (p1) First\n- [ ] (p2) Second' });
      const orch = new Orchestrator(task.id, project.id, [
        { id: 'q1', points: ['p1'], agentId: agent.id, reviewerId: agent.id, queueMode: 'execute', parallelGroup: null, status: 'queued' },
        { id: 'q2', points: ['p2'], agentId: agent.id, queueMode: 'execute', parallelGroup: null, status: 'queued' },
      ]);
      await orch.start();
      await until(() => orch.state.status === 'finished');
      assert.deepEqual(orch.state.sessions.map(s => s.status), ['complete', 'complete']);
      assert.equal(orch.state.sessions[0].reviewRound, 1);
    } finally { await host.shutdownSessions(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  } finally { await host.shutdownSessions(); getDb().close(); }
});
