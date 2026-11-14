import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';

test('execution roots, errands, task chats and independent review rounds', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-execution-'));
  process.env.PLANGENT_DATA_DIR = path.join(temporary, 'data');
  const git = (cwd: string, ...args: string[]) => {
    assert.ok(!path.relative(temporary, cwd).startsWith('..'));
    return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  };
  const { getDb } = await import('../../infrastructure/db/schema');
  const projects = await import('../../core-services').then(() => import('../../core/projects'));
  const tasks = await import('../../core-services').then(() => import('../../core/tasks'));
  const { createAgent } = await import('../../core-services').then(() => import('../../core/agents/catalog'));
  const sessions = await import('../../core-services').then(() => import('../../core/agents/sessions/sessions'));
  const host = await import('../../core-services').then(() => import('../../core/agents/sessions/acp-host'));
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  const workspaces = await import('../../core-services').then(() => import('../../core/workspaces/index'));
  const { prepareWork } = await import('../../core-services').then(() => import('../../core/work/start'));
  const { createErrand } = await import('../../core-services').then(() => import('../../core/work/errands'));
  const { taskChat } = await import('../../core-services').then(() => import('../../core/work/task-chat'));
  const { taskContextFor } = await import('../../core/work/task-context');
  const taskReview = await import('../../core-services').then(() => import('../../core/review/code/task-review'));
  const { reviews } = await import('../../core-services').then(() => import('../../core/review/code/reviews'));
  const { createReviewStore } = await import('../../infrastructure/db/repositories/review/code');
  const { createPlan } = await import('../../core-services').then(() => import('../../core/preparation/plans'));
  const queues = await import('../../core-services').then(() => import('../../core/execution/queue'));
  const { getOrchestrator } = await import('../../core-services').then(() => import('../../core/execution/orchestrator'));
  const { orchestratorRouter } = await import('../../core-services').then(() => import('../../api/http/routes/orchestrator'));
  const { workRouter } = await import('../../core-services').then(() => import('../../api/http/routes/work'));
  const { sessionMcpConfig, allowed } = await import('../../core-services').then(() => import('../../api/mcp/server'));
  sessions.initSessions(); queues.initQueues();
  host.configureSessionHost({ mcp: sessionMcpConfig, terminate: killProcessTree });
  const agent = createAgent({ name: 'Workflow fixture', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs'), '--inspect-workspace', '--hold-task-review'] });
  const repo = path.join(temporary, 'repo'); fs.mkdirSync(repo);
  git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(repo, 'code.txt'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Fixture');
  const remote = path.join(temporary, 'remote.git');
  git(repo, 'init', '--bare', remote); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main');
  const project = projects.createProject({ name: 'Execution', repo_path: repo, default_agent_id: agent.id, git_settings: { base_branch: 'main' } });
  const app = express(); app.use(express.json());
  app.use('/projects/:projectId', workRouter);
  app.use('/projects/:projectId/tasks/:taskId', orchestratorRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const post = (url: string, body: object = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 15000;
    while (!check()) { assert.ok(Date.now() < deadline, 'timed out'); await new Promise(r => setTimeout(r, 25)); }
  };
  const queueTask = tasks.createTask({ project_id: project.id, title: 'Execute a task' });
  try {
    await t.test('queue prepares workspace before execution, reruns reuse it', async () => {
      createPlan({ task_id: queueTask.id, content: '- [ ] (p1) Implement' });
      queues.saveQueue(queues.replaceStages(queues.getQueue(queueTask.id, project.id), [{ sessions: [{ points: ['p1'], agentId: agent.id }] }]));
      const url = '/projects/' + project.id + '/tasks/' + queueTask.id + '/queue/start';
      assert.equal((await post(url)).status, 202);
      const workspace = workspaces.activeWorkspace(queueTask.id)!;
      assert.equal(workspace.status, 'ready'); assert.notEqual(workspace.path, repo);
      assert.equal(git(repo, 'branch', '--show-current'), 'main');
      const executor = sessions.listSessions(project.id).find(s => s.task_id === queueTask.id && s.role === 'executor')!;
      await until(() => sessions.getSession(executor.id).status === 'waiting');
      const report = sessions.history(executor.id).filter(e => e.type === 'assistant').map(e => e.payload.text).join('');
      assert.equal(JSON.parse(report).cwd, workspace.path);
      await getOrchestrator(queueTask.id)!.stop();
      assert.equal((await post(url, { branch_name: 'ignored-on-restart', auto_review: true, review_agent: { agent_id: agent.id } })).status, 202);
      assert.equal(tasks.getTask(queueTask.id)!.auto_review, true);
      assert.equal(tasks.getTask(queueTask.id)!.review_agent?.agent_id, agent.id);
      assert.equal(getOrchestrator(queueTask.id)!.queue.stages.flatMap(stage => stage.sessions).some(s => s.kind === 'review'), false, 'the automatic review follows the queue');
      assert.equal(workspaces.activeWorkspace(queueTask.id)!.id, workspace.id);
      await getOrchestrator(queueTask.id)!.stop();
    });
    await t.test('failed setup is recorded, the folder stays usable and commands report it', async () => {
      const badRepo = path.join(temporary, 'bad-repo');
      git(temporary, 'clone', remote, badRepo);
      const badProject = projects.createProject({ name: 'Bad setup', repo_path: badRepo, default_agent_id: agent.id,
        git_settings: { base_branch: 'main', workspace_setup_command: 'exit 7' } });
      const task = tasks.createTask({ project_id: badProject.id });
      createPlan({ task_id: task.id, content: '- [ ] (p1) Implement' });
      queues.saveQueue(queues.replaceStages(queues.getQueue(task.id, badProject.id), [{ sessions: [{ points: ['p1'], agentId: agent.id }] }]));
      assert.equal((await post('/projects/' + badProject.id + '/tasks/' + task.id + '/queue/start')).status, 202);
      await until(() => /code 7/.test(workspaces.activeWorkspace(task.id)!.error));
      assert.equal(workspaces.activeWorkspace(task.id)!.status, 'ready');
      await assert.rejects(workspaces.ensureWorkspaceSetup(task.id), /code 7/);
      await getOrchestrator(task.id)?.stop();
    });
    const errand = await createErrand(project.id, { text: 'Correct card spacing', agent_id: agent.id });
    await t.test('errand runs in workspace, keeps the developer\'s title and chat stays the same', async () => {
      const workspace = workspaces.activeWorkspace(errand.task.id)!;
      assert.equal(workspace.status, 'ready'); assert.ok(allowed(errand.session).includes('complete_step'));
      await until(() => ['ready', 'complete'].includes(sessions.getSession(errand.session.id).status));
      const report = sessions.history(errand.session.id).filter(e => e.type === 'assistant').map(e => e.payload.text).join('');
      assert.equal(JSON.parse(report).cwd, workspace.path);
      assert.equal(tasks.getTask(errand.task.id)?.title, 'Correct card spacing');
      assert.equal((await taskChat(errand.task.id)).id, errand.session.id);
    });
    await t.test('task chat is lazy, includes all steps and reports, and is reused', async () => {
      const executor = sessions.createSession({ project_id: project.id, task_id: queueTask.id, agent_id: agent.id,
        role: 'executor', policy: 'allow-all', step_ids: ['p1'] });
      sessions.updateSession(executor.id, { status: 'complete', reason: 'Implemented requested behavior' });
      const chat = await taskChat(queueTask.id);
      assert.equal(chat.role, 'task-chat');
      // The briefing only points at the tool; the context itself is read on demand.
      assert.match(String(chat.metadata.briefing), /get_task_context/);
      assert.doesNotMatch(String(chat.metadata.briefing), /Implemented requested behavior/);
      const context = await taskContextFor(queueTask.id);
      assert.match(JSON.stringify(context.executor_reports), /Implemented requested behavior/);
      assert.match(context.plan, /Implement/);
      assert.equal((await taskChat(queueTask.id)).id, chat.id);
      assert.equal(chat.agent_id, agent.id, 'the first follow-up agent is the executor\'s');
      // Replacing starts a new agent; later rounds go to it, the old chat stays.
      sessions.updateSession(chat.id, { status: 'ready' });
      const replaced = await taskChat(queueTask.id, agent.id, { replace: true });
      assert.notEqual(replaced.id, chat.id); assert.equal(replaced.role, 'task-chat');
      assert.equal((await taskChat(queueTask.id)).id, replaced.id);
      assert.equal((await taskChat(errand.task.id, undefined, { replace: true })).id, errand.session.id, 'an errand changes its agent in place');
    });
    await t.test('manual reviews retain rounds including rejected, fixed and empty results', async () => {
      const task = errand.task, workspace = workspaces.activeWorkspace(task.id)!;
      fs.writeFileSync(path.join(workspace.path, 'code.txt'), 'changed\n');
      let chat = await taskReview.launchIndependentReview(task.id);
      assert.equal(chat.role, 'task-reviewer'); assert.equal(chat.policy, 'read-only');
      assert.equal(getOrchestrator(task.id), undefined);
      await assert.rejects(taskReview.launchIndependentReview(task.id), /уже/);
      const finding = await taskReview.addTaskRemark(chat, { scope: 'line', kind: 'fix', file: 'code.txt', line_start: 1, text: 'Reject this' });
      const fix = await taskReview.addTaskRemark(chat, { scope: 'file', kind: 'fix', file: 'code.txt', text: 'Correct spacing' });
      await taskReview.submitTaskReview(sessions.getSession(chat.id), 'Two findings');
      await host.closeSession(chat.id);
      const service = reviews(workspace.id);
      await service.closeItem(project.id, finding.review.id, finding.item.id, 'reject');
      createReviewStore().updateItem(fix.item.id, { status: 'done', closed: true });
      chat = await taskReview.launchIndependentReview(task.id);
      const brief = await taskReview.taskReviewBrief(chat);
      assert.equal(brief.rounds.length, 2);
      assert.ok(brief.existing_review.items.some(i => i.id === finding.item.id && i.status === 'rejected'));
      assert.ok(brief.existing_review.items.some(i => i.id === fix.item.id && i.status === 'done'));
      await taskReview.submitTaskReview(sessions.getSession(chat.id), 'No new findings');
      await host.closeSession(chat.id);
      assert.equal((await service.current(project.id)).rounds.length, 2);
    });
    await t.test('a review covers the chosen range, uses the picked agent and carries the developer\'s words', async () => {
      const task = errand.task;
      sessions.addEvent(errand.session.id, 'user', { text: 'Please change the spacing in code.txt' });
      sessions.updateSession(errand.session.id, { metadata: { ...sessions.getSession(errand.session.id).metadata, review_agent: { agent_id: agent.id, model: '', effort: '' } } });
      const chat = await taskReview.launchIndependentReview(task.id, { mode: 'worktree', context: 'Look at the spacing' });
      assert.equal(chat.agent_id, agent.id);
      const brief = await taskReview.taskReviewBrief(chat);
      assert.equal(brief.range.mode, 'worktree');
      assert.equal(brief.developer_context, 'Look at the spacing');
      assert.match(JSON.stringify(brief.developer_requests), /change the spacing/);
      assert.match(JSON.stringify(brief.changes), /changed/);
      await taskReview.submitTaskReview(sessions.getSession(chat.id), 'Range review');
      await host.closeSession(chat.id);
      await assert.rejects(taskReview.launchIndependentReview(task.id, { mode: 'branch' }), /ветку/);
    });
    await t.test('review remarks go to the existing task/errand chat', async () => {
      for (const task of [queueTask, errand.task]) {
        const service = reviews(workspaces.activeWorkspace(task.id)!.id);
        const draft = await service.addDraft(project.id, { scope: 'file', kind: 'fix', file: 'code.txt', text: 'Please fix' }, 'task', task.id);
        const expected = await taskChat(task.id);
        const result = await post('/projects/' + project.id + '/tasks/' + task.id + '/check/send', { item_ids: [draft.item.id] });
        assert.equal(result.status, 200);
        assert.equal((await result.json() as { id: string }).id, expected.id);
        await until(() => ['ready', 'complete'].includes(sessions.getSession(expected.id).status));
        assert.equal((await service.getAgentReview(sessions.getSession(expected.id))).assigned[0].id, draft.item.id);
      }
    });
    await t.test('one-line HTTP creation returns immediately with a task and starts its agent in background', async () => {
      const response = await post('/projects/' + project.id + '/errands', { text: 'Created through one line', agent_id: agent.id });
      assert.equal(response.status, 202);
      const payload = await response.json() as { task: import('../../models').Task; session?: unknown };
      assert.equal(payload.task.kind, 'errand'); assert.equal(payload.task.status, 'in_progress');
      assert.equal(payload.session, undefined);
      const chat = () => sessions.listSessions(project.id).find(s => s.task_id === payload.task.id && s.role === 'errand');
      await until(() => chat()?.status === 'complete');
      assert.equal(workspaces.activeWorkspace(payload.task.id)!.status, 'ready');
      const { workEntry } = await import('../../core/work');
      await until(() => chat()?.metadata.work_done === true);
      assert.equal(workEntry(payload.task.id).state.canCheck, true);
    });
    await t.test('an errand from a number and description waits for the request in its chat', async () => {
      const errand = await createErrand(project.id, { title: 'Profile layout', external_key: 'PROJ-7', agent_id: agent.id, policy: 'ask', branch_name: 'fix/profile-layout' });
      assert.equal(errand.task.title, 'Profile layout'); assert.equal(errand.task.external_key, 'PROJ-7');
      assert.equal(workspaces.activeWorkspace(errand.task.id)?.branch, 'fix/profile-layout');
      assert.equal(errand.session.policy, 'ask');
      const { workEntry } = await import('../../core-services').then(() => import('../../core/work'));
      assert.equal(workEntry(errand.task.id).state.text, 'Напишите агенту, что сделать');
      assert.equal(workEntry(errand.task.id).state.canCheck, false);
      assert.equal(sessions.history(errand.session.id).some(e => e.type === 'user'), false);
      await assert.rejects(createErrand(project.id, { agent_id: agent.id }), /номер задачи или описание/);
    });
    await t.test('an existing branch gets its own folder; the main folder takes one work at a time', async () => {
      git(repo, 'branch', 'feature/existing');
      const existing = await createErrand(project.id, { title: 'Continue', agent_id: agent.id, place: 'existing', branch: 'feature/existing' });
      assert.equal(workspaces.activeWorkspace(existing.task.id)?.branch, 'feature/existing');
      const main = await createErrand(project.id, { title: 'Here', agent_id: agent.id, place: 'existing', branch: git(repo, 'branch', '--show-current') });
      assert.equal(workspaces.activeWorkspace(main.task.id), null);
      assert.equal(await workspaces.rootForSession(main.session), project.repo_path);
      await assert.rejects(createErrand(project.id, { title: 'Second', agent_id: agent.id, place: 'main' }), /основной папке уже идёт работа/);
      tasks.updateTask(main.task.id, { closed_at: new Date().toISOString(), status: 'done' });
    });
    await t.test('a task with a plan gets its branch and review agent at creation and one automatic review after its queue', async () => {
      git(repo, 'branch', 'feature/planned');
      const response = await post('/projects/' + project.id + '/plan-tasks', { title: 'Planned', place: 'existing', branch: 'feature/planned',
        auto_review: true, review_agent: { agent_id: agent.id } });
      assert.equal(response.status, 202);
      const { task } = await response.json() as { task: import('../../models').Task };
      assert.equal(task.kind, 'task'); assert.deepEqual(task.review_agent, { agent_id: agent.id, model: '', effort: '' });
      await until(() => workspaces.activeWorkspace(task.id)?.status === 'ready' && !!tasks.getTask(task.id)!.base_commit);
      assert.equal(workspaces.activeWorkspace(task.id)!.branch, 'feature/planned');
      fs.writeFileSync(path.join(workspaces.activeWorkspace(task.id)!.path, 'planned.txt'), 'done\n');
      const { broadcast } = await import('../../core-services').then(() => import('../../core/shared'));
      const reviewers = () => sessions.listSessions(project.id).filter(s => s.task_id === task.id && s.role === 'task-reviewer');
      broadcast({ type: 'queue_finished', taskId: task.id, projectId: project.id, failed: 0 });
      await until(() => reviewers().length === 1);
      assert.equal(reviewers()[0].agent_id, agent.id);
      broadcast({ type: 'queue_finished', taskId: task.id, projectId: project.id, failed: 0 });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(reviewers().length, 1, 'a later queue run is a follow-up');
      await until(() => sessions.getSession(reviewers()[0].id).status === 'thinking');
      await taskReview.submitTaskReview(reviewers()[0], 'Plan review complete');
      await host.closeSession(reviewers()[0].id);
    });
    await t.test('automatic errand review runs once after a normal turn', async () => {
      const errand = await createErrand(project.id, { text: 'Review this automatically', agent_id: agent.id, auto_review: true });
      const reviewers = () => sessions.listSessions(project.id).filter(s => s.task_id === errand.task.id && s.role === 'task-reviewer');
      await until(() => reviewers().length === 1 && sessions.getSession(reviewers()[0].id).status === 'thinking');
      assert.equal(sessions.getSession(errand.session.id).status, 'complete');
      host.sessionSignals.emit('turn_end', errand.session.id);
      assert.equal(reviewers().length, 1);
      await taskReview.submitTaskReview(reviewers()[0], 'Automatic review complete');
      await host.closeSession(reviewers()[0].id);
    });
    await t.test('group errands and tasks use group folder without workspaces', async () => {
      const group = projects.createProject({ name: 'Group', kind: 'group', default_agent_id: agent.id });
      const errand = await createErrand(group.id, { text: 'Group work', agent_id: agent.id });
      assert.equal(workspaces.activeWorkspace(errand.task.id), null);
      await until(() => ['ready', 'complete'].includes(sessions.getSession(errand.session.id).status));
      assert.equal(await workspaces.rootForSession(errand.session), group.repo_path);
      const reviewer = await taskReview.launchIndependentReview(errand.task.id);
      const finding = await taskReview.addTaskRemark(reviewer, { scope: 'general', kind: 'fix', text: 'Review group work' });
      await taskReview.submitTaskReview(sessions.getSession(reviewer.id), 'Group review');
      await host.closeSession(reviewer.id);
      const check = await fetch(base + '/projects/' + group.id + '/tasks/' + errand.task.id + '/check');
      assert.equal(check.status, 200);
      const sent = await post('/projects/' + group.id + '/tasks/' + errand.task.id + '/check/send', { item_ids: [finding.item.id] });
      assert.equal(sent.status, 200);
      await until(() => sessions.getSession(errand.session.id).status === 'complete');
      assert.equal((await reviews(undefined, errand.task.id).getAgentReview(sessions.getSession(errand.session.id))).assigned[0].id, finding.item.id);
      const task = tasks.createTask({ project_id: group.id });
      await prepareWork(task.id);
      assert.equal(workspaces.activeWorkspace(task.id), null);
    });
  } finally {
    await getOrchestrator(queueTask.id)?.stop();
    const { stopWatchPlanFile } = await import('../../core-services').then(() => import('../../core/preparation/plan-file'));
    const { stopWatchAnalysis } = await import('../../core-services').then(() => import('../../core/tasks/task-files'));
    for (const project of projects.listProjects()) for (const task of tasks.listTasks(project.id)) { stopWatchPlanFile(task.id); stopWatchAnalysis(task.id); }
    await until(() => !sessions.listSessions().some(s => s.title === 'Название поручения' && ['starting', 'thinking'].includes(s.status)));
    await host.shutdownSessions();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
  }
});
