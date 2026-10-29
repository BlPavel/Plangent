import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type { Workspace } from '../../models';

test('work roots: task numbering, HTTP, subscriptions, review, baseline and parallel finish', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-workflow-'));
  process.env.PLANGENT_DATA_DIR = path.join(temporary, 'data');
  // Git mutations are confined to this disposable fixture.
  const git = (cwd: string, ...args: string[]) => {
    assert.ok(!path.relative(temporary, cwd).startsWith('..'));
    return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  };
  const { getDb, migrate } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask, updateTask, getTask } = await import('../tasks');
  const { captureTaskBaseCommit } = await import('../tasks/base-commit');
  const { insertWorkspace, updateWorkspace } = await import('./store');
  const { rootForTask, rootForWorkspace, rootForSession } = await import('./roots');
  const { initSessions, getSession, updateSession, history, listSessions } = await import('../agent-sessions/sessions');
  const { createFinishService } = await import('../finish');
  const { activeFinish, insertFinish, getFinish } = await import('../finish/store');
  const { assertRepositoryIdle } = await import('../code/git-busy');
  const { serializeNetworkGit } = await import('../code/git-write');
  const { createReviewService } = await import('../code-reviews/reviews');
  const { codeRouter } = await import('../../infrastructure/http/routes/code');
  const { gitRouter } = await import('../../infrastructure/http/routes/git');
  const { tasksRouter } = await import('../../infrastructure/http/routes/tasks');
  const { createCodeReviewsRouter } = await import('../../infrastructure/http/routes/code-reviews');
  const { attachCodeSubscriptions } = await import('../../infrastructure/http/code-subscriptions');
  const { agentSessionsRouter } = await import('../../infrastructure/http/routes/agent-sessions');
  const db = getDb(); initSessions();
  const repo = path.join(temporary, 'repo'); await fs.mkdir(repo);
  git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(repo, 'code.txt'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Fixture');
  const agent = db.prepare('SELECT id FROM agents LIMIT 1').get() as { id: string };
  const project = createProject({ name: 'Workflow', repo_path: repo, default_agent_id: agent.id });
  const first = createTask({ project_id: project.id });
  const second = createTask({ project_id: project.id, kind: 'errand', auto_review: true, origin_task_id: first.id });
  const workspaces: Workspace[] = [];
  for (const [index, task] of [first, second].entries()) {
    const root = path.join(temporary, 'work-' + index), branch = 'work-' + index;
    git(repo, 'worktree', 'add', '-b', branch, root);
    git(root, 'commit', '--allow-empty', '-m', 'Workspace baseline ' + index);
    const workspace = insertWorkspace({ project_id: project.id, task_id: task.id, branch, base_branch: 'main', path: root });
    workspaces.push(updateWorkspace(workspace.id, { status: 'ready' }));
    await fs.writeFile(path.join(root, 'code.txt'), 'workspace ' + index + '\n');
  }
  const app = express(); app.use(express.json());
  app.use('/sessions', agentSessionsRouter);
  app.use('/projects/:projectId/code', codeRouter);
  app.use('/projects/:projectId/git', gitRouter);
  app.use('/projects/:projectId/tasks', tasksRouter);
  app.use('/projects/:projectId/reviews', createCodeReviewsRouter());
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const wss = new WebSocketServer({ server }); wss.on('connection', attachCodeSubscriptions);
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const url = base + '/projects/' + project.id;
  const request = async (route: string, body?: object, method = 'POST') => fetch(url + route, body ? {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined);
  try {
    await t.test('automatic keys coexist with manual keys and fields survive migration', async () => {
      assert.equal(first.key, 'Задача-1'); assert.equal(second.key, 'Задача-2');
      assert.equal(first.kind, 'task'); assert.equal(first.auto_review, false);
      assert.equal(second.kind, 'errand'); assert.equal(second.auto_review, true);
      createTask({ project_id: project.id, key: 'Задача-10' });
      createTask({ project_id: project.id, key: 'EXT-900' });
      assert.equal(createTask({ project_id: project.id }).key, 'Задача-11');
      const now = new Date().toISOString();
      updateTask(second.id, { closed_at: now, close_reason: 'cancelled' });
      migrate(db);
      assert.equal(getTask(second.id)?.closed_at, now);
      assert.equal(getTask(second.id)?.origin_task_id, first.id);
      assert.equal(getTask(second.id)?.auto_review, true);
      const created = await request('/tasks', { title: 'Automatic via HTTP', kind: 'errand' });
      assert.equal(created.status, 201);
      assert.equal((await created.json() as { key: string }).key, 'Задача-12');
      assert.equal((await request('/tasks', { kind: 'invalid' })).status, 400);
      assert.throws(() => createTask({ project_id: project.id, auto_review: 2 as never }));
    });
    await t.test('HTTP and branch reviews resolve the selected root and reject foreign ids', async () => {
      assert.deepEqual(await (await request('/code/changes')).json(), []);
      for (const [index, workspace] of workspaces.entries()) {
        const suffix = '?workspace=' + workspace.id;
        const changes = await (await request('/code/changes' + suffix)).json() as { path: string }[];
        assert.equal(changes[0].path, 'code.txt');
        assert.equal((await (await request('/code/file' + suffix + '&path=code.txt')).json() as { content: string }).content, 'workspace ' + index + '\n');
        assert.equal((await (await request('/git/repository' + suffix)).json() as { branch: string }).branch, workspace.branch);
        const review = await request('/reviews/items' + suffix, { scope: 'file', kind: 'fix', file: 'code.txt', text: 'Review ' + index });
        assert.equal(review.status, 201);
        assert.equal((await review.json() as { review: { branch: string } }).review.branch, workspace.branch);
      }
      assert.equal((await request('/code/changes?workspace=missing')).status, 404);
      const foreignRoot = path.join(temporary, 'foreign'); await fs.mkdir(foreignRoot);
      const foreign = createProject({ name: 'Foreign', repo_path: foreignRoot });
      assert.throws(() => rootForWorkspace(foreign.id, workspaces[0].id));
      const main = await createReviewService().current(project.id);
      assert.equal(main.review, null);
      const head = git(workspaces[0].path, 'rev-parse', 'HEAD');
      assert.equal((await captureTaskBaseCommit(first.id)).base_commit, head);
      assert.notEqual(head, git(repo, 'rev-parse', 'HEAD'));
      assert.equal(rootForTask(first.id), workspaces[0].path);
    });
    await t.test('subscriptions are independent for both workspaces', async () => {
      const socket = new WebSocket(base.replace('http:', 'ws:'));
      const messages: { type: string; workspaceId?: string }[] = [];
      socket.on('message', data => messages.push(JSON.parse(data.toString())));
      await once(socket, 'open');
      const until = async (check: () => boolean) => {
        const deadline = Date.now() + 5000;
        while (!check()) { assert.ok(Date.now() < deadline, 'subscription timeout'); await new Promise(r => setTimeout(r, 25)); }
      };
      try {
        for (const workspace of workspaces) socket.send(JSON.stringify({ type: 'code:subscribe', projectId: project.id, workspaceId: workspace.id }));
        await until(() => messages.filter(m => m.type === 'code:subscribed').length === 2);
        git(workspaces[0].path, 'add', 'code.txt');
        await until(() => messages.some(m => m.type === 'code:changed' && m.workspaceId === workspaces[0].id));
        assert.ok(!messages.some(m => m.type === 'code:changed' && m.workspaceId === workspaces[1].id));
      } finally { socket.close(); await once(socket, 'close'); }
    });
    await t.test('network operations serialize across a shared common directory', async () => {
      let active = 0, max = 0;
      await Promise.all(workspaces.map(w => serializeNetworkGit(w.path, async () => {
        active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 40)); active--;
      })));
      assert.equal(max, 1);
    });
    await t.test('executor, preflight and task review use the work root and the absolute main plan', async () => {
      const { createAgent } = await import('../agents');
      const host = await import('../agent-sessions/acp-host');
      const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
      const queues = await import('../orchestration/queue');
      const { Orchestrator } = await import('../orchestration/orchestrator');
      const { createPlan } = await import('../orchestration/plans');
      const { getPlanFilePath } = await import('../orchestration/task-files');
      const { stopWatchPlanFile } = await import('../orchestration/plan-file');
      const { taskReviewBrief, addTaskRemark, submitTaskReview } = await import('../orchestration/task-review');
      queues.initQueues(); host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
      const inspector = createAgent({ name: 'Root inspector', command: process.execPath, acp_command: process.execPath,
        acp_args: [path.resolve('scripts/mock-acp-agent.mjs'), '--inspect-workspace', '--hold-task-review'] });
      createPlan({ task_id: first.id, content: '- [ ] (p1) Implement' });
      const queue = queues.replaceStages(queues.getQueue(first.id, project.id), [
        { sessions: [{ points: ['p1'], agentId: inspector.id, queueMode: 'review_first' }] },
        { sessions: [{ kind: 'review', agentId: inspector.id }] },
      ]);
      const orch = new Orchestrator(queue);
      const execution = queue.stages[0].sessions[0], review = queue.stages[1].sessions[0];
      const until = async (check: () => boolean) => {
        const deadline = Date.now() + 10000;
        while (!check()) { assert.ok(Date.now() < deadline, 'queue timeout'); await new Promise(r => setTimeout(r, 25)); }
      };
      try {
        await orch.start(); await until(() => execution.status === 'ready_for_execution');
        const session = getSession(execution.sessionId!);
        const output = JSON.parse(String(history(session.id).filter(e => e.type === 'assistant').at(-1)!.payload.text));
        assert.equal(output.cwd, workspaces[0].path);
        assert.ok(String(session.metadata.briefing).includes(getPlanFilePath(repo, first.key)));
        await orch.executeReadySession(execution.id);
        await until(() => execution.status === 'waiting_for_developer');
        assert.ok(String(getSession(session.id).metadata.briefing).includes(getPlanFilePath(repo, first.key)));
        await orch.manualComplete(execution.id);
        await until(() => !!review.sessionId);
        const reviewer = getSession(review.sessionId!);
        const brief = await taskReviewBrief(reviewer);
        assert.equal(brief.range.repository && (brief.range.repository as { branch: string }).branch, workspaces[0].branch);
        assert.match(JSON.stringify(brief.changes), /workspace 0/);
        const finding = await addTaskRemark(reviewer, { scope: 'line', file: 'code.txt', line_start: 1, kind: 'fix', text: 'Task finding' });
        assert.equal(finding.review.branch, workspaces[0].branch);
        await submitTaskReview(reviewer, 'Reviewed worktree');
        const response = await fetch(base + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: project.id, agent_id: inspector.id, role: 'code-fixer', workspace_id: workspaces[0].id }) });
        assert.equal(response.status, 201);
        const fixer = await response.json() as { id: string };
        await until(() => getSession(fixer.id).status === 'ready');
        const scoped = createReviewService(db, {}, workspaces[0].id);
        await scoped.sendRound(project.id, finding.review.id, fixer.id);
        await until(() => history(fixer.id).some(e => e.type === 'assistant'));
        const fixed = JSON.parse(String(history(fixer.id).filter(e => e.type === 'assistant').at(-1)!.payload.text));
        assert.equal(fixed.cwd, workspaces[0].path);
      } finally {
        await orch.stop('Test cleanup');
        for (const session of listSessions(project.id).filter(s => s.agent_id === inspector.id)) await host.closeSession(session.id);
        stopWatchPlanFile(first.id);
      }
    });
    await t.test('task MR preview uses the work branch while main stays checked out', async () => {
      const { createTaskMrService } = await import('../task-mr');
      const service = createTaskMrService(async () => ({ connectionId: 'test', projectPath: 'test/project', host: {} }) as never);
      const preview = await service.preview(project.id, first.id, 'main');
      assert.equal(preview.source_branch, workspaces[0].branch);
      assert.equal(preview.head, git(workspaces[0].path, 'rev-parse', 'HEAD'));
    });
    await t.test('two finish workflows can run, but a second one in the same root cannot', async () => {
      const finish = createFinishService({ prompt: async id => { updateSession(id, { status: 'ready' }); }, close: async () => {} });
      const runs = await Promise.all([first, second].map(task => finish.start(project.id, { task_id: task.id, scenario: 'commits', branchName: 'must-be-ignored' })));
      assert.ok(runs[0]); assert.ok(runs[1]);
      assert.throws(() => insertFinish({ ...runs[0]!, id: 'duplicate-finish' }), /UNIQUE/);
      for (const [index, run] of runs.entries()) {
        assert.ok(run);
        assert.equal(run.workspace_id, workspaces[index].id);
        assert.equal(run.branch, workspaces[index].branch);
        assert.equal(activeFinish(project.id, workspaces[index].id)?.id, run.id);
        assert.equal(await rootForSession(getSession(run.session_id!)), workspaces[index].path);
        assert.throws(() => assertRepositoryIdle(project.id, undefined, workspaces[index].path));
      }
      assert.doesNotThrow(() => assertRepositoryIdle(project.id));
      await assert.rejects(finish.start(project.id, { task_id: first.id, scenario: 'commits' }));
      await Promise.all(runs.map(async (run, index) => {
        assert.ok(run);
        await finish.setCommits(run.id, [{ files: ['code.txt'], title: 'Change ' + index }], true);
        await finish.finishCommits(run.id); await finish.accept(run.id);
      }));
      assert.equal(git(repo, 'branch', '--show-current'), 'main');
      assert.equal(git(repo, 'log', '-1', '--format=%s'), 'Fixture');
      migrate(db);
      for (const [index, run] of runs.entries()) {
        assert.equal(getFinish(run!.id).workspace_id, workspaces[index].id);
        assert.equal(getFinish(run!.id).status, 'complete');
      }
      assert.deepEqual(db.pragma('foreign_key_check'), []);
    });
  } finally {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close(); await fs.rm(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
