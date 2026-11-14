import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import * as gitRead from '../../infrastructure/git/read';
import * as gitWrite from '../../infrastructure/git/write';
import { DomainError } from '../../models/domain-error';

// The workflow uses real Git in disposable repositories and isolated in-memory records.
// No command runs against the active project and no application database is opened.
function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-switch-branch-'));
  const repo = path.join(temporary, 'repo'), root = path.join(temporary, 'workspace');
  fs.mkdirSync(repo);
  const git = (cwd: string, ...args: string[]) => {
    assert.ok(!path.relative(temporary, cwd).startsWith('..'));
    return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  };
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(repo, 'code.txt'), 'base\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Fixture');
  git(repo, 'branch', 'feature/next');
  git(repo, 'worktree', 'add', '-b', 'feature/original', root);
  const head = git(root, 'rev-parse', 'HEAD');
  const state = {
    task: { id: 'task', project_id: 'project', status: 'draft', closed_at: null as string | null, branch_name: 'feature/original', base_commit: head },
    workspace: { id: 'workspace', task_id: 'task', project_id: 'project', status: 'ready', branch: 'feature/original', base_branch: 'main', path: root },
    queue: { status: 'idle' }, sessions: [] as { task_id?: string; status: string; metadata: { workspace_id?: string } }[],
    owners: [] as { id: string; branch: string }[], finish: false, events: [] as { type: string }[],
  };
  const mocks: Record<string, unknown> = {
    '../tasks': { getTask: (id: string) => id === state.task.id ? state.task : null },
    '../projects': { getProject: (id: string) => id === 'project' ? { id, kind: 'project', repo_path: repo } : null },
    '../workspaces': { activeWorkspace: () => state.workspace, getWorkspace: () => state.workspace,
      listWorkspaces: () => [state.workspace, ...state.owners] },
    '../agents': { listSessions: () => state.sessions },
    '../execution': { getQueue: () => state.queue, isFrozen: (queue: { status: string }) => ['running', 'paused'].includes(queue.status) },
    '../git': { executeGitOperation: async (input: { root: string; signal?: AbortSignal }, action: (root: string, options: gitWrite.GitOperationOptions) => Promise<unknown>) => {
      input.signal?.throwIfAborted();
      return { output: await action(input.root, { signal: input.signal, assertIdle: () => { if (state.finish) throw new DomainError('Finish is active', 409); } }) };
    } },
    '../../infrastructure/git/read': gitRead, '../../infrastructure/git/write': gitWrite,
    '../../infrastructure/db/repositories/work/branch': { saveWorkBranch: (_task: string, _workspace: string, branch: string) => {
      state.task = { ...state.task, branch_name: branch }; state.workspace = { ...state.workspace, branch };
    } },
    '../shared': { broadcast: (event: { type: string }) => state.events.push(event) },
    '../../models/domain-error': { DomainError },
    './start': { withWorkStart: (_id: string, action: () => Promise<unknown>) => action() },
  };
  const module = { exports: {} as typeof import('../../core/work/branch') };
  const source = ts.transpileModule(fs.readFileSync(path.resolve('server/core/work/branch.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext('(function(require, module, exports) {' + source + '\n})')((name: string) => {
    assert.ok(name in mocks, 'Unexpected dependency ' + name); return mocks[name];
  }, module, module.exports);
  return { state, root, repo, temporary, git, change: module.exports.changeWorkBranch,
    dispose: () => fs.rmSync(temporary, { recursive: true, force: true }) };
}

test('switching and creating branches keeps the worktree, baseline and task binding consistent', async () => {
  const f = fixture();
  try {
    const before = { ...f.state.workspace };
    const result = await f.change('project', 'task', { branch: 'feature/next' });
    assert.equal(f.git(f.root, 'branch', '--show-current'), 'feature/next');
    assert.equal(result.task.branch_name, 'feature/next');
    assert.equal(result.workspace.branch, 'feature/next');
    assert.equal(result.workspace.path, before.path); assert.equal(result.workspace.id, before.id);
    assert.equal(result.task.base_commit, f.state.task.base_commit);
    assert.equal(f.git(f.repo, 'branch', '--show-current'), 'main');
    assert.ok(f.state.events.some(e => e.type === 'workspace:update'));
    assert.ok(f.state.events.some(e => e.type === 'task_updated'));
    const head = f.git(f.root, 'rev-parse', 'HEAD');
    await f.change('project', 'task', { branch: 'feature/new', create: true });
    assert.equal(f.git(f.root, 'branch', '--show-current'), 'feature/new');
    assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), head);
    assert.equal(f.git(f.root, 'rev-parse', 'feature/original'), head, 'the previous branch is retained');
    assert.equal(f.state.workspace.branch, 'feature/new');
    f.git(f.repo, 'commit', '--allow-empty', '-m', 'Different base');
    const baseHead = f.git(f.repo, 'rev-parse', 'main');
    await f.change('project', 'task', { branch: 'feature/from-main', create: true, base: 'main' });
    assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), baseHead, 'the base chosen in the shared picker is used');
  } finally { f.dispose(); }
});

test('dirty files, occupied branches, active work and invalid ownership prevent switching', async () => {
  const f = fixture();
  const change = () => f.change('project', 'task', { branch: 'feature/next' });
  try {
    fs.writeFileSync(path.join(f.root, 'code.txt'), 'keep my changes');
    await assert.rejects(change(), /незакоммиченные/);
    assert.equal(fs.readFileSync(path.join(f.root, 'code.txt'), 'utf8'), 'keep my changes');
    fs.writeFileSync(path.join(f.root, 'code.txt'), 'base\n');
    await assert.rejects(f.change('project', 'task', { branch: 'main' }), /другой рабочей папке/);
    f.state.owners = [{ id: 'other', branch: 'feature/next' }];
    await assert.rejects(change(), /другой задачей/); f.state.owners = [];
    for (const status of ['running', 'paused']) {
      f.state.queue.status = status; await assert.rejects(change(), /Остановите/);
    }
    f.state.queue.status = 'idle';
    for (const status of ['thinking', 'starting', 'waiting']) {
      f.state.sessions = [{ task_id: 'task', status, metadata: {} }];
      await assert.rejects(change(), /Остановите/);
    }
    f.state.sessions = [{ status: 'thinking', metadata: { workspace_id: 'workspace' } }];
    await assert.rejects(change(), /Остановите/); f.state.sessions = [];
    f.state.finish = true; await assert.rejects(change(), /Finish/); f.state.finish = false;
    f.state.task.closed_at = 'closed'; await assert.rejects(change(), /закрыта/); f.state.task.closed_at = null;
    await assert.rejects(f.change('wrong', 'task', { branch: 'feature/next' }), /not found/);
    await assert.rejects(f.change('project', 'task', { branch: '-invalid' }), /Некорректное/);
    await assert.rejects(f.change('project', 'task', { branch: 'missing' }), /not found/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.change('project', 'task', { branch: 'feature/next' }, controller.signal));
    assert.equal(f.git(f.root, 'branch', '--show-current'), 'feature/original');
    assert.equal(f.state.workspace.branch, 'feature/original');
    assert.equal(f.state.task.branch_name, 'feature/original');
    assert.equal(f.state.events.length, 0);
  } finally { f.dispose(); }
});

test('a failing post-checkout hook still records the branch Git actually checked out', async () => {
  const f = fixture();
  try {
    const hooks = path.join(f.temporary, 'hooks'); fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'post-checkout'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    f.git(f.repo, 'config', 'core.hooksPath', hooks);
    await assert.rejects(f.change('project', 'task', { branch: 'feature/next' }));
    assert.equal(f.git(f.root, 'branch', '--show-current'), 'feature/next');
    assert.equal(f.state.workspace.branch, 'feature/next');
    assert.equal(f.state.task.branch_name, 'feature/next');
  } finally { f.dispose(); }
});

test('a remote-only branch gets a local tracking branch and a matching task binding', async () => {
  const f = fixture();
  try {
    const remote = path.join(f.temporary, 'origin.git'); fs.mkdirSync(remote);
    f.git(remote, 'init', '--bare', '-b', 'main');
    f.git(f.repo, 'remote', 'add', 'origin', remote);
    f.git(f.repo, 'push', 'origin', 'feature/next:refs/heads/remote-only');
    f.git(f.repo, 'fetch', 'origin');
    await f.change('project', 'task', { branch: 'remote-only' });
    assert.equal(f.git(f.root, 'branch', '--show-current'), 'remote-only');
    assert.equal(f.git(f.root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'), 'origin/remote-only');
    assert.equal(f.state.task.branch_name, 'remote-only');
    assert.equal(f.state.workspace.branch, 'remote-only');
  } finally { f.dispose(); }
});
