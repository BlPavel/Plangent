import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('stdio ACP lifecycle persists coalesced messages, serializes queue, resolves permissions and loads sessions', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-acp-test-'));
  process.env.PLANGENT_DATA_DIR = temp;
  const { getDb } = await import('../../../infrastructure/db/schema');
  const repository = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const host = await import('../../../core-services').then(() => import('../../../core/agents/sessions/acp-host'));
  const { createAgent } = await import('../../../core-services').then(() => import('../../../core/agents/catalog'));
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { killProcessTree } = await import('../../../infrastructure/terminal/process-tree');
  repository.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath, acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs')] });
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
    await host.sendPrompt(session.id, [{ type: 'text', text: 'permission' }], true);
    await until(() => host.snapshot(session.id).permissions.length === 1);
    assert.ok(await host.authorizeGitAction(session.id, 'Git fetch', false));
    const destructive = host.authorizeGitAction(session.id, 'Git discard file', true);
    await until(() => host.snapshot(session.id).permissions.length === 2);
    const gitPermission = host.snapshot(session.id).permissions.find(p => p.toolCall.title === 'Git discard file')!;
    host.answerPermission(session.id, gitPermission.permissionId, 'reject');
    assert.equal(await destructive, null);
    const acpPermission = host.snapshot(session.id).permissions[0];
    host.answerPermission(session.id, acpPermission.permissionId, 'yes');
    await until(() => repository.history(session.id).filter(e => e.type === 'turn_end').length === 5);
    assert.equal(await host.authorizeGitAction(session.id, 'Git fetch', false), null);
    await host.sendPrompt(session.id, [{ type: 'text', text: 'permission' }]);
    await until(() => host.snapshot(session.id).permissions.length === 1);
    await host.sendPrompt(session.id, [{ type: 'text', text: 'permission' }], true);
    assert.equal(JSON.parse(host.snapshot(session.id).queue[0].content).gitForTurn, true);
    const firstTurnGit = host.authorizeGitAction(session.id, 'Git fetch', false);
    await until(() => host.snapshot(session.id).permissions.length === 2);
    host.answerPermission(session.id, host.snapshot(session.id).permissions.find(p => p.toolCall.title === 'Git fetch')!.permissionId, 'reject');
    assert.equal(await firstTurnGit, null);
    host.answerPermission(session.id, host.snapshot(session.id).permissions[0].permissionId, 'yes');
    await until(() => repository.history(session.id).filter(e => e.type === 'turn_end').length === 6 && host.snapshot(session.id).permissions.length === 1);
    const nextTurnSignal = await host.authorizeGitAction(session.id, 'Git fetch', false);
    assert.ok(nextTurnSignal && !nextTurnSignal.aborted);
    host.answerPermission(session.id, host.snapshot(session.id).permissions[0].permissionId, 'yes');
    await until(() => repository.history(session.id).filter(e => e.type === 'turn_end').length === 7);
    await until(() => nextTurnSignal.aborted);
    const count = repository.history(session.id).length;
    await host.closeSession(session.id);
    await host.startSession(session.id);
    assert.equal(repository.history(session.id).length, count);
    const { createApp } = await import('../../../core-services').then(() => import('../../../api/http/server'));
    const { sessionMcpConfig } = await import('../../../core-services').then(() => import('../../../api/mcp/server'));
    const { createTask } = await import('../../../core-services').then(() => import('../../../core/tasks'));
    const { createPlan } = await import('../../../core-services').then(() => import('../../../core/preparation/plans'));
    const { Orchestrator, getOrchestrator } = await import('../../../core-services').then(() => import('../../../core/execution/orchestrator'));
    const queues = await import('../../../core-services').then(() => import('../../../core/execution/queue'));
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
      assert.deepEqual((await (await call(headers, 'tools/list')).json() as { result: { tools: { name: string }[] } }).result.tools.map(t => t.name), ['git_action']);
      const git = (...args: string[]) => execFileSync('git', args, { cwd: temp, encoding: 'utf8', windowsHide: true });
      git('init', '-b', 'main'); git('config', 'user.name', 'Human'); git('config', 'user.email', 'human@test.invalid');
      fs.writeFileSync(path.join(temp, 'chat-file.txt'), 'from chat');
      await host.sendPrompt(session.id, [{ type: 'text', text: 'permission' }]);
      await until(() => host.snapshot(session.id).permissions.length === 1);
      const { callTool, allowed } = await import('../../../core-services').then(() => import('../../../api/mcp/server'));
      const group = createProject({ kind: 'group', name: 'Group' });
      assert.ok(!allowed({ ...session, project_id: group.id }).includes('git_action'));
      assert.ok(!allowed({ ...session, role: 'executor' }).includes('git_action'));
      assert.ok(allowed({ ...session, role: 'task-chat' }).includes('git_action'));
      const { prepareChatGitAction } = await import('../../../core-services').then(() => import('../../../core/git/repo/chat-action'));
      for (const args of [{ action: 'discard', paths: ['chat-file.txt'] }, { action: 'stash', stashAction: 'drop' }, { action: 'merge', branch: 'main' }, { action: 'rebase', branch: 'main' }])
        assert.equal((await prepareChatGitAction(session, args)).alwaysAsk, true);
      await assert.rejects(prepareChatGitAction(session, { action: 'push', force: true }), /Unexpected/);
      await assert.rejects(prepareChatGitAction(session, { action: 'reset' }), /Invalid/);
      await assert.rejects(prepareChatGitAction(session, { action: 'commit', paths: ['chat-file.txt'], title: 'x', amend: true }), /Unexpected/);
      const pendingGit = callTool(session.id, 'git_action', { action: 'commit', paths: ['chat-file.txt'], title: 'chat change' });
      await until(() => host.snapshot(session.id).permissions.length === 2);
      const approval = host.snapshot(session.id).permissions.find(p => p.toolCall.title?.startsWith('Git:'))!;
      assert.throws(() => git('rev-parse', '--verify', 'HEAD'));
      host.answerPermission(session.id, approval.permissionId, 'allow');
      assert.ok(!(await pendingGit).isError);
      assert.equal(git('show', 'HEAD:chat-file.txt'), 'from chat');
      host.answerPermission(session.id, host.snapshot(session.id).permissions[0].permissionId, 'yes');
      await until(() => repository.getSession(session.id).status === 'ready');
      fs.writeFileSync(path.join(temp, 'chat-file.txt'), 'second change');
      await host.sendPrompt(session.id, [{ type: 'text', text: 'permission' }], true);
      await until(() => host.snapshot(session.id).permissions.length === 1);
      const withoutCard = await callTool(session.id, 'git_action', { action: 'commit', paths: ['chat-file.txt'], title: 'second change' });
      assert.ok(!withoutCard.isError);
      assert.equal(host.snapshot(session.id).permissions.length, 1);
      assert.equal(git('show', 'HEAD:chat-file.txt'), 'second change');
      fs.writeFileSync(path.join(temp, 'chat-file.txt'), 'preserve me');
      const pendingDiscard = callTool(session.id, 'git_action', { action: 'discard', paths: ['chat-file.txt'] });
      await until(() => host.snapshot(session.id).permissions.length === 2);
      const discardApproval = host.snapshot(session.id).permissions.find(p => p.toolCall.title?.includes('"discard"'))!;
      host.answerPermission(session.id, discardApproval.permissionId, 'reject');
      assert.ok(!(await pendingDiscard).isError);
      assert.equal(fs.readFileSync(path.join(temp, 'chat-file.txt'), 'utf8'), 'preserve me');
      host.answerPermission(session.id, host.snapshot(session.id).permissions[0].permissionId, 'yes');
      await until(() => repository.getSession(session.id).status === 'ready');
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
      assert.deepEqual(tools, ['get_interview_guide', 'get_plan', 'submit_plan', 'get_plan_review_items', 'reply_plan_remark']);
      repository.updateSession(planner.id, { status: 'thinking' });
      const empty = await (await call(plannerHeaders, 'tools/call', { name: 'submit_plan', arguments: { content: 'just prose' } })).json() as { result: { isError?: boolean } };
      assert.equal(empty.result.isError, true);
      await call(plannerHeaders, 'tools/call', { name: 'submit_plan', arguments: { content: '# Plan\n- [ ] (p7) Invented id\n- [ ] Second' } });
      const { getLatestPlan } = await import('../../../core-services').then(() => import('../../../core/preparation/plans'));
      assert.match(getLatestPlan(planTask.id)!.content, /- \[ \] \(p1\) Invented id\n- \[ \] \(p2\) Second/);
      assert.equal(getLatestPlan(planTask.id)!.author, 'agent');
      assert.equal(getLatestPlan(planTask.id)!.session_id, planner.id);
      assert.ok(fs.existsSync(path.join(temp, '.plangent', 'PLAN-TEST', 'plan.md')));
      await call(plannerHeaders, 'tools/call', { name: 'submit_plan', arguments: { content: '- [ ] (p1) Invented id\n- [ ] Inserted\n- [x] (p2) Second' } });
      assert.match(getLatestPlan(planTask.id)!.content, /\(p1\) Invented id\n- \[ \] \(p2\) Inserted\n- \[x\] \(p3\) Second/);
      (await import('../../../core-services').then(() => import('../../../core/preparation/plan-file'))).stopWatchPlanFile(planTask.id);
      const task = createTask({ project_id: project.id, key: 'ACP-TEST' });
      createPlan({ task_id: task.id, content: '- [ ] (p1) First\n- [ ] (p2) Second' });
      queues.saveQueue(queues.replaceStages(queues.getQueue(task.id, project.id), [
        { sessions: [{ points: ['p1'], agentId: agent.id }] },
        { sessions: [{ points: ['p2'], agentId: agent.id }] },
      ]));
      const legacy = queues.getQueue(task.id, project.id);
      Object.assign(legacy.stages[0].sessions[0], { reviewerId: agent.id, reviewSessionId: 'old-chat', reviewRound: 1, maxReviewRounds: 2 });
      getDb().prepare('UPDATE task_queues SET data=? WHERE task_id=?').run(JSON.stringify(legacy), task.id);
      const queue = queues.getQueue(task.id, project.id);
      assert.ok(!Object.keys(queue.stages[0].sessions[0]).some(key => key.startsWith('review')));
      const orch = new Orchestrator(queue);
      await orch.start();
      await until(() => queue.status === 'finished');
      // A finished run moves to the history; the queue is empty for the next one.
      assert.equal(queue.stages.length, 0);
      const ran = queue.history![0].stages.flatMap(st => st.sessions);
      assert.deepEqual(ran.map(s => s.status), ['complete', 'complete']);
      assert.ok(!Object.keys(ran[0]).some(key => key.startsWith('review')));
      assert.equal(repository.listSessions(project.id).filter(s => s.task_id === task.id).length, 2);
      // The protocol goes as a hidden briefing: the chat shows only the steps.
      const executorFirst = repository.history(ran[0].sessionId!).find(e => e.type === 'user')!;
      assert.equal(executorFirst.payload.briefing, true);
      assert.match(String(executorFirst.payload.text), /^Execute the steps:\n- p1\. First$/);
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
      (await import('../../../core-services').then(() => import('../../../core/preparation/plan-file'))).stopWatchPlanFile(task.id);
    } finally { await host.shutdownSessions(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  } finally { await host.shutdownSessions(); getDb().close(); }
});
