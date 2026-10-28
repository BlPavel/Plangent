import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

test('reviewer MCP and planner delivery preserve scoped cards, decisions, history and resumption', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-plan-agent-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const sessions = await import('../agent-sessions/sessions');
  const host = await import('../agent-sessions/acp-host');
  const { createAgent } = await import('../agents');
  const { createProject, updateProject } = await import('../projects');
  const { createTask } = await import('../tasks');
  const { createPlan } = await import('../orchestration/plans');
  const { submitPlan, stopWatchPlanFile } = await import('../orchestration/plan-file');
  const { initQueues } = await import('../orchestration/queue');
  const { planReviews } = await import('./index');
  const { launch } = await import('./agent');
  const { askReviewer } = await import('./reviewer');
  const { candidates, deliver } = await import('./planner-transport');
  const { mcpRouter, sessionMcpConfig, allowed } = await import('../../infrastructure/mcp/server');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  sessions.initSessions(); initQueues();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = createAgent({ name: 'Mock', acp_command: process.execPath, acp_args: [path.resolve('scripts/mock-acp-agent.mjs')] });
  const project = createProject({ name: 'Review', repo_path: root });
  updateProject(project.id, { default_agent_id: agent.id });
  const task = createTask({ project_id: project.id, key: 'TASK' });
  const service = planReviews();
  const app = express(); app.use(express.json()); app.use('/mcp', mcpRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.env.PLANGENT_URL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const untilReady = async (id: string) => {
    const limit = Date.now() + 10000;
    while (sessions.getSession(id).status !== 'ready') {
      if (Date.now() > limit) throw new Error('Timed out');
      await new Promise(r => setTimeout(r, 25));
    }
  };
  const call = async (id: string, name: string, args: unknown = {}) => {
    const config = sessionMcpConfig(sessions.getSession(id), true)[0] as { headers: { name: string; value: string }[] };
    const response = await fetch(process.env.PLANGENT_URL + '/mcp', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...Object.fromEntries(config.headers.map(h => [h.name, h.value])) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const result = await response.json() as { error?: unknown; result?: { isError?: boolean; content: { text: string }[] } };
    return { failed: !!result.error || !!result.result?.isError, data: result.result?.content[0]?.text };
  };
  try {
    createPlan({ task_id: task.id, content: '- [ ] (p1) First\n- [ ] (p2) Second' });
    const opened = await launch(project.id, task.id, { agent_id: agent.id, wish: 'Check order' });
    const reviewer = opened.session_id;
    await untilReady(reviewer);
    assert.equal(sessions.getSession(reviewer).policy, 'read-only');
    assert.throws(() => sessions.updateSession(reviewer, { policy: 'allow-all' }));
    assert.deepEqual(allowed(sessions.getSession(reviewer)), ['get_plan_review_brief', 'set_plan_review_overview', 'add_plan_remark', 'answer_plan_remark', 'revise_plan_remark']);
    sessions.updateSession(reviewer, { status: 'thinking' });
    assert.equal((await call(reviewer, 'submit_plan', { content: 'Forbidden' })).failed, true);
    const brief = JSON.parse((await call(reviewer, 'get_plan_review_brief')).data!);
    assert.ok(brief.protocol.length); assert.equal(brief.wish, 'Check order'); assert.ok(brief.analysis.groups);
    assert.equal((await call(reviewer, 'add_plan_remark', { steps: ['p99'], kind: 'order', text: 'Bad' })).failed, true);
    const a = JSON.parse((await call(reviewer, 'add_plan_remark', { steps: ['p1'], kind: 'order', text: 'Fix order' })).data!);
    const b = JSON.parse((await call(reviewer, 'add_plan_remark', { steps: [], kind: 'unclear', text: 'Explain' })).data!);
    const rejected = JSON.parse((await call(reviewer, 'add_plan_remark', { steps: [], kind: 'risk', text: 'Rejected risk' })).data!);
    assert.equal((await call(reviewer, 'set_plan_review_overview', { overview: 'Summary', coverage: [{ requirement: 'R', steps: ['p1'], status: 'partial', remark_id: a.id }] })).failed, false);
    service.decision(project.id, task.id, opened.review.id, a.id, { status: 'accepted', comment: 'Keep checks' });
    service.decision(project.id, task.id, opened.review.id, b.id, { status: 'discussing', comment: 'Why this order?' });
    service.decision(project.id, task.id, opened.review.id, rejected.id, { status: 'rejected', comment: 'Already covered' });
    // Discussion is with the reviewer: it answers in the card, and nothing goes to a planner until every card is decided.
    sessions.updateSession(reviewer, { status: 'thinking' });
    assert.equal((await call(reviewer, 'answer_plan_remark', { id: a.id, text: 'Not discussed' })).failed, true);
    assert.equal((await call(reviewer, 'answer_plan_remark', { id: b.id, text: 'Because p2 needs p1' })).failed, false);
    // The developer's comment waits as a draft until the batch goes to the reviewer.
    assert.equal(service.detail(project.id, task.id, opened.review.id).remarks.find(r => r.id === b.id)!.messages.find(m => m.author === 'developer')!.sent, false);
    await askReviewer(project.id, task.id, opened.review.id);
    assert.equal(service.detail(project.id, task.id, opened.review.id).remarks.find(r => r.id === b.id)!.messages.find(m => m.author === 'developer')!.sent, true);
    await assert.rejects(askReviewer(project.id, task.id, opened.review.id), /Nothing to send/);
    // After the discussion the reviewer rewrites the card; the first version stays for the developer, and only discussing cards can be rewritten.
    assert.equal((await call(reviewer, 'revise_plan_remark', { id: a.id, text: 'Not discussed' })).failed, true);
    assert.equal((await call(reviewer, 'revise_plan_remark', { id: b.id, text: 'Reorder only p2 and p3', suggestion: 'Move p3 before p2' })).failed, false);
    const discussed = service.detail(project.id, task.id, opened.review.id).remarks.find(r => r.id === b.id)!;
    assert.equal(discussed.status, 'discussing');
    assert.equal(discussed.messages.at(-1)!.author, 'reviewer');
    assert.equal(discussed.text, 'Reorder only p2 and p3');
    assert.deepEqual(discussed.original, { text: 'Explain', suggestion: '' });
    await assert.rejects(deliver(project.id, task.id, opened.review.id, { session_id: null }), /decision/);
    service.decision(project.id, task.id, opened.review.id, b.id, { status: 'accepted', comment: 'Then fix the order' });
    assert.equal(candidates(project.id, task.id).default_session_id, null);
    const sent = await deliver(project.id, task.id, opened.review.id, { session_id: null });
    const planner = sent.session_id;
    await untilReady(planner);
    assert.equal(sent.remarks.find(r => r.id === rejected.id)!.status, 'rejected');
    sessions.updateSession(planner, { status: 'thinking' });
    const items = JSON.parse((await call(planner, 'get_plan_review_items')).data!);
    assert.deepEqual(items.assigned.map((r: { id: string }) => r.id), [a.id, b.id]);
    assert.equal(items.remarks, undefined);
    // The planner gets the cards alone: no discussion, the rewritten text, the developer's clarification.
    assert.equal(items.assigned[0].developer_clarification, 'Keep checks');
    assert.equal(items.assigned[1].text, 'Reorder only p2 and p3');
    assert.equal(items.assigned[1].suggestion, 'Move p3 before p2');
    assert.equal(items.assigned[1].developer_clarification, 'Then fix the order');
    assert.equal(items.assigned[1].messages, undefined);
    assert.equal(items.assigned[1].original, undefined);
    assert.equal((await call(planner, 'reply_plan_remark', { id: rejected.id, kind: 'answer', text: 'No' })).failed, true);
    assert.equal((await call(planner, 'reply_plan_remark', { id: b.id, kind: 'options', text: '1. Keep p1 first (recommended). 2. Swap.' })).failed, false);
    assert.equal(service.detail(project.id, task.id, opened.review.id).remarks.find(r => r.id === b.id)!.status, 'answered');
    submitPlan(task, root, '- [ ] (p1) First fixed\n- [ ] (p2) Second', true, planner);
    assert.equal(service.detail(project.id, task.id, opened.review.id).remarks.find(r => r.id === a.id)!.status, 'applied');
    assert.equal((await call(planner, 'reply_plan_remark', { id: a.id, kind: 'change', text: 'Fixed p1' })).failed, false);
    sessions.updateSession(planner, { status: 'ready' });
    assert.equal(candidates(project.id, task.id).default_session_id, planner);
    sessions.updateSession(planner, { status: 'thinking' });
    service.decision(project.id, task.id, opened.review.id, b.id, { status: 'accepted', comment: 'Explain option 2' });
    await assert.rejects(deliver(project.id, task.id, opened.review.id, { session_id: planner }), /responding/);
    sessions.updateSession(planner, { status: 'ready' });
    await host.closeSession(planner);
    assert.equal(candidates(project.id, task.id).default_session_id, planner);
    const continued = await deliver(project.id, task.id, opened.review.id, {});
    assert.equal(continued.session_id, planner);
    await untilReady(planner);
    const again = await launch(project.id, task.id, {});
    await untilReady(again.session_id);
    sessions.updateSession(again.session_id, { status: 'thinking' });
    const round = JSON.parse((await call(again.session_id, 'get_plan_review_brief')).data!);
    assert.equal(round.history[0].remarks.find((r: { id: string }) => r.id === rejected.id).decision, 'Already covered');
    getDb().prepare('INSERT INTO task_queues(task_id,data) VALUES (?,?)').run(task.id, JSON.stringify({ status: 'running' }));
    assert.equal((await call(again.session_id, 'get_plan_review_brief')).failed, true);
    await assert.rejects(launch(project.id, task.id, {}), /frozen/);
    await assert.rejects(deliver(project.id, task.id, opened.review.id, {}), /frozen/);
    getDb().prepare('DELETE FROM task_queues WHERE task_id=?').run(task.id);
    // Delivery failure leaves cards available to retry, and does not mark developer messages sent.
    const bad = createAgent({ name: 'Unavailable' });
    const failing = service.create(project.id, task.id);
    const card = service.addRemark(project.id, task.id, failing.review.id, { steps: [], kind: 'risk', text: 'Retry' });
    service.decision(project.id, task.id, failing.review.id, card.id, { status: 'accepted', comment: 'Question' });
    await assert.rejects(deliver(project.id, task.id, failing.review.id, { session_id: null, agent_id: bad.id }));
    const untouched = service.detail(project.id, task.id, failing.review.id).remarks[0];
    assert.equal(untouched.status, 'accepted');
    assert.equal(untouched.messages[0].sent, false);
    const other = createTask({ project_id: project.id, key: 'OTHER' });
    await assert.rejects(deliver(project.id, other.id, failing.review.id, {}), /not found/i);
  } finally {
    stopWatchPlanFile(task.id);
    await host.shutdownSessions();
    await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
    delete process.env.PLANGENT_URL;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
