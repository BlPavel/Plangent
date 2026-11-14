import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';

test('branch HTTP action updates persistent task and workspace records together', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-branch-http-'));
  process.env.PLANGENT_DATA_DIR = path.join(temporary, 'data');
  const repo = path.join(temporary, 'repo'), root = path.join(temporary, 'workspace'); fs.mkdirSync(repo);
  const git = (cwd: string, ...args: string[]) => {
    assert.ok(!path.relative(temporary, cwd).startsWith('..'));
    return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  };
  git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(repo, 'code.txt'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Fixture');
  git(repo, 'branch', 'feature/next'); git(repo, 'worktree', 'add', '-b', 'feature/original', root);
  await import('../../core-services');
  const { getDb, closeDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../../core/projects');
  const { createTask, updateTask, getTask } = await import('../../core/tasks');
  const { insertWorkspace, updateWorkspace, getWorkspace } = await import('../../core/workspaces');
  const { initQueues, getQueue, saveQueue } = await import('../../core/execution/queue');
  const { initSessions } = await import('../../core/agents');
  const { workRouter } = await import('../../api/http/routes/work');
  const { saveWorkBranch } = await import('../../infrastructure/db/repositories/work/branch');
  const { stopWatchAnalysis } = await import('../../core/tasks/task-files');
  initSessions(); initQueues();
  const project = createProject({ name: 'Branch HTTP', repo_path: repo });
  const task = createTask({ project_id: project.id });
  const head = git(root, 'rev-parse', 'HEAD');
  updateTask(task.id, { branch_name: 'feature/original' });
  getDb().prepare('UPDATE tasks SET base_commit=? WHERE id=?').run(head, task.id);
  const workspace = insertWorkspace({ project_id: project.id, task_id: task.id, branch: 'feature/original', base_branch: 'main', path: root });
  updateWorkspace(workspace.id, { status: 'ready' });
  const app = express(); app.use(express.json()); app.use('/api/projects/:projectId', workRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const request = (projectId = project.id, body: unknown = { branch: 'feature/next' }) => fetch(base + '/api/projects/' + projectId + '/tasks/' + task.id + '/switch-branch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await request('wrong')).status, 404);
    assert.equal((await request(project.id, { branch: 4 })).status, 400);
    fs.writeFileSync(path.join(root, 'code.txt'), 'manual changes');
    const dirty = await request();
    assert.equal(dirty.status, 409, JSON.stringify(await dirty.json()));
    assert.equal(fs.readFileSync(path.join(root, 'code.txt'), 'utf8'), 'manual changes');
    fs.writeFileSync(path.join(root, 'code.txt'), 'base\n');
    const queue = getQueue(task.id, project.id); queue.status = 'paused'; saveQueue(queue);
    assert.equal((await request()).status, 409);
    queue.status = 'idle'; saveQueue(queue);
    const response = await request();
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const result = await response.json() as { task: { branch_name: string; base_commit: string }; workspace: { branch: string; id: string; path: string } };
    assert.equal(result.task.branch_name, 'feature/next'); assert.equal(result.task.base_commit, head);
    assert.equal(result.workspace.branch, 'feature/next'); assert.equal(result.workspace.id, workspace.id); assert.equal(result.workspace.path, root);
    assert.equal(getTask(task.id)!.branch_name, 'feature/next'); assert.equal(getWorkspace(workspace.id).branch, 'feature/next');
    assert.equal(git(root, 'branch', '--show-current'), 'feature/next'); assert.equal(git(repo, 'branch', '--show-current'), 'main');
    getDb().exec("CREATE TEMP TRIGGER reject_branch BEFORE UPDATE OF branch_name ON tasks BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END");
    assert.throws(() => saveWorkBranch(task.id, workspace.id, 'feature/not-saved'), /fixture rejection/);
    assert.equal(getWorkspace(workspace.id).branch, 'feature/next', 'a failed task update rolls back the workspace update');
    getDb().exec('DROP TRIGGER reject_branch');
    assert.equal((await request(project.id, { branch: 'feature/new', create: true })).status, 200);
    assert.equal(getTask(task.id)!.branch_name, 'feature/new'); assert.equal(getWorkspace(workspace.id).branch, 'feature/new');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    stopWatchAnalysis(task.id); closeDb(); fs.rmSync(temporary, { recursive: true, force: true });
  }
});
