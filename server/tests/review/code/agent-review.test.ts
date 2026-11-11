import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { once } from 'node:events';

test('Code agent reviews pin the selected range, keep history and obey lifecycle and ownership', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-code-agent-'));
  process.env.PLANGENT_DATA_DIR = path.join(temp, 'data');
  const root = path.join(temp, 'repo'); fs.mkdirSync(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const write = (file: string, text: string) => fs.writeFileSync(path.join(root, file), text);
  const { getDb } = await import('../../../infrastructure/db/schema');
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const agents = await import('../../../core-services').then(() => import('../../../core/agents'));
  const host = await import('../../../core-services').then(() => import('../../../core/agents/sessions/acp-host'));
  const { killProcessTree } = await import('../../../infrastructure/terminal/process-tree');
  const { launchCodeReview, previewCodeReview, codeReviewBrief, addCodeRemark, submitCodeReview } = await import('../../../core-services').then(() => import('../../../core/review/code/agent-review'));
  const { reviews } = await import('../../../core-services').then(() => import('../../../core/review/code/reviews'));
  const { callTool, allowed } = await import('../../../api/mcp/server');
  const { createCodeReviewsRouter } = await import('../../../api/http/routes/code-reviews');
  const { branchReviewRouter } = await import('../../../api/http/routes/branch-review');
  agents.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = agents.createAgent({ name: 'Reviewer', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs'), '--hold-task-review'] });
  const project = createProject({ name: 'Code review', repo_path: root });
  const input = { mode: 'worktree' as const, agent_id: agent.id };
  const app = express(); app.use(express.json());
  app.use('/api/projects/:projectId/code-reviews', createCodeReviewsRouter());
  app.use('/api/projects/:projectId/branch-review', branchReviewRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/projects/' + project.id;
  const post = async (route: string, body: unknown) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function thinking(id: string) {
    const deadline = Date.now() + 10000;
    while (agents.getSession(id).status !== 'thinking') {
      if (Date.now() > deadline) throw new Error('Agent did not start');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return agents.getSession(id);
  }
  t.after(async () => {
    await host.shutdownSessions();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close(); fs.rmSync(temp, { recursive: true, force: true });
  });

  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('code.txt', 'base\n'); write('deleted.txt', 'remove\n');
  git('add', '.'); git('commit', '-m', 'Base');
  const baseline = git('rev-parse', 'HEAD');
  git('switch', '-c', 'feature'); write('code.txt', 'committed\n'); git('add', '.'); git('commit', '-m', 'Feature');
  git('switch', 'main'); write('upstream.txt', 'unrelated\n'); git('add', '.'); git('commit', '-m', 'Upstream');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD'); git('switch', 'feature');
  write('code.txt', 'staged\n'); git('add', 'code.txt'); write('code.txt', 'working\n'); write('new.txt', 'new\n'); fs.unlinkSync(path.join(root, 'deleted.txt'));

  await t.test('preview and capture use merge-base and include the worktree without changing the real index', async () => {
    const index = git('ls-files', '--stage');
    const preview = await previewCodeReview(project.id, { ...input, mode: 'branch', ref: 'origin/main' });
    assert.equal(preview.base, baseline);
    assert.deepEqual(preview.files.sort(), ['code.txt', 'deleted.txt', 'new.txt']);
    const response = await post('/code-reviews/agent/start', { ...input, mode: 'branch', ref: 'refs/remotes/origin/main' });
    assert.equal(response.status, 201);
    const created = await response.json() as { id: string };
    const session = await thinking(created.id);
    assert.equal(session.policy, 'read-only'); assert.equal(session.task_id, null);
    assert.throws(() => agents.updateSession(session.id, { policy: 'allow-all' }), /read-only/);
    assert.deepEqual(allowed(session), ['get_task_review_brief', 'add_task_remark', 'submit_task_review', 'request_help', 'report_progress']);
    const result = await callTool(session.id, 'get_task_review_brief', {});
    const brief = JSON.parse(result.content[0].text);
    assert.equal(brief.range.base, baseline); assert.equal(brief.range.ref, 'refs/remotes/origin/main');
    assert.match(JSON.stringify(brief.changes), /working/); assert.doesNotMatch(JSON.stringify(brief.changes), /upstream.txt/);
    assert.equal(git('ls-files', '--stage'), index);
    await assert.rejects(launchCodeReview(project.id, input), /работает|выполняется/);
    const finding = await addCodeRemark(session, { scope: 'line', file: 'code.txt', line_start: 1, kind: 'fix', text: 'Fix this' });
    assert.equal(finding.item.author, 'agent'); assert.equal(finding.item.origin, 'project');
    assert.equal(finding.item.round_id, session.metadata.task_review_round);
    const deleted = await addCodeRemark(session, { scope: 'file', file: 'deleted.txt', kind: 'question', text: 'Was deletion intended?' });
    await reviews().closeItem(project.id, finding.review.id, deleted.item.id, 'reject');
    write('code.txt', 'edited during review\n');
    assert.match(JSON.stringify((await codeReviewBrief(session)).changes), /working/);
    await assert.rejects(addCodeRemark(session, { scope: 'line', file: 'code.txt', line_start: 1, kind: 'fix', text: 'Stale' }), /Файл изменился/);
    await submitCodeReview(session, 'Two findings'); await host.closeSession(session.id);
    await assert.rejects(addCodeRemark(session, { scope: 'general', kind: 'fix', text: 'Late' }), /No active/);
  });

  await t.test('repeat reviews retain findings and empty reports; concurrent starts produce one reviewer', async () => {
    const starts = await Promise.allSettled([launchCodeReview(project.id, input), launchCodeReview(project.id, input)]);
    assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
    const created = starts.find(result => result.status === 'fulfilled')!;
    assert.equal(created.status, 'fulfilled');
    if (created.status !== 'fulfilled') return;
    const session = await thinking(created.value.id);
    const brief = await codeReviewBrief(session);
    assert.equal(brief.rounds.length, 2); assert.equal(brief.existing_review.items.length, 2);
    assert.ok(brief.existing_review.items.some(item => item.status === 'rejected'));
    assert.ok(brief.previous_reports.some(report => report.summary === 'Two findings'));
    const result = await callTool(session.id, 'submit_task_review', { summary: 'No new findings' });
    assert.equal(result.isError, undefined);
    assert.equal(agents.getSession(session.id).reason, 'No new findings');
    await host.closeSession(session.id);
  });

  await t.test('branch switches, foreign scopes and stopped sessions reject late findings', async () => {
    const session = await thinking((await launchCodeReview(project.id, input)).id);
    const other = createProject({ name: 'Other', repo_path: path.join(temp, 'other') });
    await assert.rejects(codeReviewBrief({ ...session, project_id: other.id }), /No active/);
    git('switch', '-c', 'other-branch');
    await assert.rejects(addCodeRemark(session, { scope: 'general', kind: 'fix', text: 'Wrong branch' }), /changed/);
    git('switch', 'feature');
    await reviews().stop(project.id, String(session.metadata.code_review_id));
    assert.equal(agents.getSession(session.id).metadata.task_review_active, false);
    await assert.rejects(submitCodeReview(session, 'Late'), /No active/);
    await host.closeSession(session.id);
  });

  await t.test('HTTP validates input, workspace and removed manual branch endpoints', async () => {
    assert.equal((await post('/code-reviews/agent/preview', { mode: 'nope' })).status, 400);
    assert.equal((await post('/code-reviews/agent/start', { mode: 'branch' })).status, 400);
    assert.equal((await post('/code-reviews/agent/start?workspace=missing', input)).status, 404);
    assert.equal((await post('/branch-review/open', { branch: 'feature', base: 'main' })).status, 404);
    assert.equal((await fetch(url + '/branch-review/branches')).status, 404);
  });

  await t.test('repositories without commits can review new files; empty scopes and non-Git folders are rejected', async () => {
    const emptyRoot = path.join(temp, 'empty'); fs.mkdirSync(emptyRoot);
    execFileSync('git', ['init', '-b', 'main'], { cwd: emptyRoot, windowsHide: true });
    const emptyProject = createProject({ name: 'Empty', repo_path: emptyRoot });
    await assert.rejects(launchCodeReview(emptyProject.id, input), /нет изменений/);
    fs.writeFileSync(path.join(emptyRoot, 'first.txt'), 'first\n');
    const preview = await previewCodeReview(emptyProject.id, input);
    assert.deepEqual(preview.files, ['first.txt']);
    const session = await thinking((await launchCodeReview(emptyProject.id, input)).id);
    const brief = await codeReviewBrief(session);
    assert.match(JSON.stringify(brief.changes), /first/);
    await submitCodeReview(session, 'Initial files checked'); await host.closeSession(session.id);
    await assert.rejects(previewCodeReview(emptyProject.id, { ...input, mode: 'branch', ref: 'main' }), /первый коммит/);
    const plainRoot = path.join(temp, 'plain'); fs.mkdirSync(plainRoot);
    const plain = createProject({ name: 'Plain', repo_path: plainRoot });
    await assert.rejects(previewCodeReview(plain.id, input), /Git/);
  });
});
