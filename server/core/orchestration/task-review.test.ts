import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { once } from 'node:events';

test('task reviews share queue lifecycle, survive reload, publish drafts and keep task baseline across commits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-task-review-'));
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  const { getDb, migrate } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask, getTask } = await import('../tasks');
  const { createAgent } = await import('../agents');
  const sessions = await import('../agent-sessions/sessions');
  const host = await import('../agent-sessions/acp-host');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  const { Orchestrator, getOrchestrator } = await import('./orchestrator');
  const queues = await import('./queue');
  const { createPlan, getLatestPlan } = await import('./plans');
  const { taskReviewBrief, addTaskRemark, submitTaskReview } = await import('./task-review');
  const { allowed, mcpRouter, sessionMcpConfig } = await import('../../infrastructure/mcp/server');
  const { reviews } = await import('../code-reviews/reviews');
  sessions.initSessions(); queues.initQueues();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = createAgent({ name: 'Mock review', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('scripts/mock-acp-agent.mjs'), '--hold-task-review', '--inspect-workspace'] });
  const project = createProject({ name: 'Task reviews', repo_path: repo });
  const task = createTask({ project_id: project.id, key: 'REVIEW-1', description: 'Implement the requested behavior' });
  const other = createTask({ project_id: project.id, key: 'REVIEW-2' });
  const plan = createPlan({ task_id: task.id, content: '- [ ] (p1) First\n- [ ] (p2) Last' });
  const app = express(); app.use(express.json()); app.use('/mcp', mcpRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.env.PLANGENT_URL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  async function until(check: () => boolean) {
    const deadline = Date.now() + 10_000;
    while (!check()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 20)); }
  }
  try {
    // Only this isolated temporary repository is mutated by the Git fixture.
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(repo, 'code.ts'), 'initial\n'); git('add', 'code.ts'); git('commit', '-m', 'Fixture baseline');
    const baseline = git('rev-parse', 'HEAD');
    const queue = queues.replaceStages(queues.getQueue(task.id, project.id), [
      { sessions: [{ points: ['p1'], agentId: agent.id }] },
      { sessions: [{ kind: 'review', agentId: agent.id, skillId: 'missing-skill' }] },
      { sessions: [{ points: ['p2'], agentId: agent.id }] },
    ]);
    queues.saveQueue(queue);
    assert.equal(queues.getQueue(task.id, project.id).stages[1].sessions[0].kind, 'review');
    assert.equal(queues.getQueue(task.id, project.id).stages[1].sessions[0].points, undefined);
    let orch = new Orchestrator(queue); await orch.start();
    const first = queue.stages[0].sessions[0], review = queue.stages[1].sessions[0], last = queue.stages[2].sessions[0];
    assert.equal(review.status, 'queued');
    await until(() => first.status === 'waiting_for_developer');
    sessions.updateSession(first.sessionId!, { reason: 'complete_step report: implemented code.ts' });
    // Add both committed and uncommitted changes after the task baseline was captured.
    fs.writeFileSync(path.join(repo, 'code.ts'), 'implemented\n'); git('add', 'code.ts'); git('commit', '-m', 'Fixture implementation');
    fs.writeFileSync(path.join(repo, 'new.ts'), 'untracked\n');
    await orch.manualComplete(first.id);
    assert.equal(review.status, 'reviewing'); assert.equal(last.status, 'queued');
    const chat = sessions.getSession(review.sessionId!);
    assert.equal(chat.role, 'task-reviewer'); assert.equal(chat.policy, 'read-only');
    assert.ok(allowed(chat).includes('add_task_remark')); assert.ok(!allowed(chat).includes('complete_step'));
    assert.throws(() => sessions.updateSession(chat.id, { policy: 'allow-all' }), /read-only/);
    const config = sessionMcpConfig(chat, true)[0] as { url: string; headers: { name: string; value: string }[] };
    const call = async (method: string, params: unknown = {}) => {
      const response = await fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...Object.fromEntries(config.headers.map(h => [h.name, h.value])) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      return response.json() as Promise<{ error?: unknown; result: { isError?: boolean; tools: { name: string; inputSchema: { required: string[] } }[] } }>;
    };
    const listed = await call('tools/list');
    assert.deepEqual(listed.result.tools.find(t => t.name === 'add_task_remark')!.inputSchema.required, ['scope', 'kind', 'text']);
    const denied = await call('tools/call', { name: 'complete_step', arguments: { summary: 'Forbidden' } });
    assert.ok(denied.error || denied.result?.isError);
    const invalid = await call('tools/call', { name: 'add_task_remark', arguments: { scope: 'invalid', kind: 'fix', text: 'bad' } });
    assert.equal(invalid.result.isError, true);
    const brief = await taskReviewBrief(chat);
    assert.equal(brief.range.base, baseline);
    assert.match(JSON.stringify(brief.changes), /implemented/); assert.match(JSON.stringify(brief.changes), /untracked/);
    assert.match(JSON.stringify(brief.executor_reports), /implemented code.ts/);
    const finding = await addTaskRemark(chat, { scope: 'line', kind: 'fix', file: 'code.ts', line_start: 1, text: 'Check implemented behavior' });
    assert.equal(finding.item.author, 'agent'); assert.equal(finding.item.origin, 'task'); assert.equal(finding.item.origin_id, task.id);
    assert.equal(finding.item.task_key, task.key); assert.equal(finding.item.code_snippet, 'implemented');
    assert.equal(finding.item.status, 'draft'); assert.equal(review.reviewId, finding.review.id);
    const fallback = await addTaskRemark(chat, { scope: 'line', kind: 'question', file: 'code.ts', line_start: 900, text: 'File question' });
    assert.equal(fallback.item.scope, 'file');
    await assert.rejects(addTaskRemark({ ...chat, task_id: other.id }, { scope: 'general', kind: 'fix', text: 'foreign' }), /active task review/);
    await submitTaskReview(sessions.getSession(chat.id), 'Two findings');
    assert.equal(review.status, 'complete'); assert.equal(review.remarks, 2);
    assert.notEqual(last.status, 'queued');
    await host.closeSession(chat.id);
    await until(() => last.status === 'waiting_for_developer');
    await orch.manualComplete(last.id);
    assert.equal(queue.status, 'finished'); assert.equal(getOrchestrator(task.id), undefined);
    assert.equal(queue.stages.length, 0);
    assert.equal(getLatestPlan(task.id)!.content.includes('[x] (p2)'), true);
    assert.equal(queues.getQueue(task.id, project.id).history![0].stages[1].sessions[0].remarks, 2);
    // A second review still sees all task changes and the first review's items after another commit.
    git('add', 'new.ts'); git('commit', '-m', 'Fixture later commit');
    queues.replaceStages(queue, [{ sessions: [{ kind: 'review', agentId: agent.id }] }]);
    orch = new Orchestrator(queue); await orch.start();
    const second = queue.stages[0].sessions[0], secondChat = sessions.getSession(second.sessionId!);
    const nextBrief = await taskReviewBrief(secondChat);
    assert.equal(nextBrief.range.base, baseline); assert.equal(getTask(task.id)!.base_commit, baseline);
    assert.match(JSON.stringify(nextBrief.changes), /implemented/); assert.match(JSON.stringify(nextBrief.changes), /untracked/);
    assert.ok(nextBrief.existing_review.items.some(i => i.id === finding.item.id));
    // Completion on ordinary turn end is supported too, without changing plan checkboxes.
    await host.cancelSession(secondChat.id);
    await until(() => queue.status === 'finished');
    assert.equal(second.status, 'complete');
    const before = sessions.listSessions(project.id).length;
    orch = new Orchestrator(queue); await orch.start();
    assert.equal(sessions.listSessions(project.id).length, before, 'completed reviews are never relaunched');
    assert.equal(queues.repeatReview(queue, second.id), true);
    const repeated = queue.stages[0].sessions[0];
    assert.notEqual(repeated.id, second.id); assert.equal(repeated.sessionId, undefined);
    assert.equal(repeated.status, 'queued'); assert.ok(queue.history!.flatMap(h => h.stages).some(st => st.sessions.includes(second)));

    // Failed/skipped work advances to review. Stop covers both active and queued reviews.
    queues.replaceStages(queue, [
      { sessions: [{ points: ['p999'], agentId: 'missing-agent' }] },
      { sessions: [{ kind: 'review', agentId: agent.id }] },
      { sessions: [{ kind: 'review', agentId: agent.id }] },
      { sessions: [{ kind: 'review', agentId: agent.id }] },
    ]);
    orch = new Orchestrator(queue); await orch.start();
    const failed = queue.stages[0].sessions[0], active = queue.stages[1].sessions[0], queued = queue.stages[2].sessions[0];
    assert.equal(failed.status, 'failed'); assert.equal(active.status, 'reviewing');
    assert.match(JSON.stringify((await taskReviewBrief(sessions.getSession(active.sessionId!))).queue), /failed/);
    const oldChat = active.sessionId;
    await orch.restartSession(active.id); assert.notEqual(active.sessionId, oldChat);
    host.sessionSignals.emit('error-state', active.sessionId!, 'Review adapter failed');
    await until(() => !!queued.sessionId);
    assert.equal(active.status, 'failed'); assert.equal(queued.status, 'reviewing');
    await orch.stop(); assert.equal(queued.status, 'stopped'); assert.equal(queue.stages[3].sessions[0].status, 'stopped');
    assert.equal(getLatestPlan(task.id)!.id, plan.id);
    migrate(getDb()); // provenance migration remains idempotent
    await reviews().removeItem(project.id, finding.review.id, finding.item.id);
    assert.ok(!(await reviews().current(project.id)).items.some(i => i.id === finding.item.id));
    // A task without Git still gets a useful review, with an explicit diff limitation.
    const plainRepo = path.join(root, 'plain'); fs.mkdirSync(plainRepo);
    const plainProject = createProject({ name: 'No Git', repo_path: plainRepo });
    const plainTask = createTask({ project_id: plainProject.id, key: 'PLAIN' });
    const plainQueue = queues.replaceStages(queues.getQueue(plainTask.id, plainProject.id), [{ sessions: [{ kind: 'review', agentId: agent.id }] }]);
    const plainOrch = new Orchestrator(plainQueue);
    try {
      await plainOrch.start();
      const plainReview = plainQueue.stages[0].sessions[0], plainChat = sessions.getSession(plainReview.sessionId!);
      const plainBrief = await taskReviewBrief(plainChat);
      assert.equal(plainBrief.changes, null); assert.ok(plainBrief.limitation);
      await addTaskRemark(plainChat, { scope: 'general', kind: 'question', text: 'Clarify the task' });
      await submitTaskReview(sessions.getSession(plainChat.id), 'Review without a baseline');
      assert.equal(plainQueue.status, 'finished'); assert.equal(getLatestPlan(plainTask.id), null);
    } finally {
      await getOrchestrator(plainTask.id)?.stop();
      (await import('./plan-file')).deletePlanFile(plainTask, plainRepo);
    }
  } finally {
    await getOrchestrator(task.id)?.stop();
    await host.shutdownSessions();
    const { deletePlanFile } = await import('./plan-file');
    deletePlanFile(task, repo);
    deletePlanFile(other, repo);
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
  }
});
