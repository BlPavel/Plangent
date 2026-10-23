import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

test('developer merge/rebase: detection, blocked writes, agent tools, edit scope and closing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-conflicts-'));
  const cwd = process.cwd(), mock = path.resolve('scripts/mock-acp-agent.mjs');
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const sessions = await import('../agent-sessions/sessions');
  const host = await import('../agent-sessions/acp-host');
  const { createAgent } = await import('../agents');
  const { createProject, updateProject } = await import('../projects');
  const { permissionDecision } = await import('../agent-sessions/permissions');
  const { allowed } = await import('../../infrastructure/mcp/server');
  const { gitOperation, conflictedFiles } = await import('../code/git');
  const { commit, switchBranch, stage, assertNoGitOperation, GitOperationError } = await import('../code/git-write');
  const { defaultGitSettings } = await import('../projects/git-settings');
  const conflicts = await import('./index');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  sessions.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath, acp_args: [mock] });
  const project = createProject({ name: 'Project', repo_path: path.join(root, 'project') });
  const repo = project.repo_path;
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (file: string, text: string) => fs.writeFileSync(path.join(repo, file), text);
  const waitIdle = async (id: string) => {
    for (let i = 0; i < 200 && ['starting', 'thinking'].includes(sessions.getSession(id).status); i++) await new Promise(resolve => setTimeout(resolve, 50));
  };
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    write('a.txt', 'base\n'); write('b.txt', 'base\n'); git('add', '.'); git('commit', '-m', 'base');
    git('switch', '-c', 'feature'); write('a.txt', 'feature\n'); write('b.txt', 'feature\n'); git('commit', '-am', 'feature work');
    git('switch', 'main'); write('a.txt', 'main\n'); write('b.txt', 'main\n'); git('commit', '-am', 'main work');
    assert.equal(await gitOperation(repo), null);

    // A rebase stops on its commit: the developer's commit is "theirs", the base is "ours".
    git('switch', 'feature');
    assert.throws(() => git('rebase', 'main'));
    const rebase = await gitOperation(repo);
    assert.equal(rebase?.kind, 'rebase'); assert.equal(rebase?.branch, 'feature'); assert.equal(rebase?.onto?.name, 'main');
    assert.deepEqual(rebase?.step, { done: 1, total: 1 }); assert.equal(rebase?.commit?.subject, 'feature work');
    git('rebase', '--abort');

    git('switch', 'main');
    assert.throws(() => git('merge', 'feature'));
    const merge = await gitOperation(repo);
    assert.equal(merge?.kind, 'merge'); assert.equal(merge?.branch, 'main'); assert.equal(merge?.commit?.name, 'feature');
    assert.deepEqual((await conflictedFiles(repo)).map(f => f.path + ':' + f.code), ['a.txt:UU', 'b.txt:UU']);

    // Plangent waits for the developer: no commit, switch or finish meanwhile; staging still marks a file resolved.
    const inProgress = (e: unknown) => e instanceof GitOperationError && e.code === 'operation_in_progress';
    await assert.rejects(assertNoGitOperation(repo), inProgress);
    await assert.rejects(commit(repo, { title: 'x' }, () => defaultGitSettings), inProgress);
    await assert.rejects(switchBranch(repo, 'feature'), inProgress);

    let state = await conflicts.conflictState(project.id);
    assert.equal(state.session, null); assert.deepEqual(state.files.map(f => f.conflicted), [true, true]);
    await assert.rejects(conflicts.resolveConflicts(project.id), /агента для конфликтов/);
    updateProject(project.id, { git_settings: { conflict_agent_id: agent.id } });
    state = await conflicts.resolveConflicts(project.id);
    const id = state.session!.id;
    await waitIdle(id);
    let session = sessions.getSession(id);
    assert.equal(session.role, 'conflict-resolver'); assert.equal(session.policy, 'allow-edits');
    assert.deepEqual(session.metadata.conflict_paths, ['a.txt', 'b.txt']);
    assert.deepEqual(allowed(session), ['get_conflicts', 'report_conflict_file', 'finish_conflicts']);

    const brief = await conflicts.conflictBrief(session);
    assert.match(brief.sides.ours, /main/); assert.match(brief.sides.theirs, /feature/);
    assert.deepEqual(brief.files.map(f => f.meaning), ['изменён с обеих сторон', 'изменён с обеих сторон']);

    // Only conflicted files, and "resolved" only without markers.
    await assert.rejects(conflicts.reportConflictFile(session, { path: 'a.txt', outcome: 'resolved', text: 'merged' }), /маркеры/);
    await assert.rejects(conflicts.reportConflictFile(session, { path: 'c.txt', outcome: 'question', text: '?' }), /не конфликтный/);
    write('a.txt', 'main\nfeature\n');
    await conflicts.reportConflictFile(session, { path: path.join(repo, 'a.txt'), outcome: 'resolved', text: 'Обе строки' });
    await conflicts.reportConflictFile(session, { path: 'b.txt', outcome: 'question', text: 'Чью версию оставить?' });
    await conflicts.answerConflict(project.id, { path: 'b.txt', text: 'main' });
    await conflicts.finishConflicts(session, 'Готово; b.txt ждёт ответа');
    state = await conflicts.conflictState(project.id);
    assert.equal(state.summary, 'Готово; b.txt ждёт ответа');
    assert.deepEqual(state.files.map(f => [f.path, f.note?.outcome, f.note?.answer, f.note?.answer_sent]), [['a.txt', 'resolved', '', false], ['b.txt', 'question', 'main', false]]);

    // The answers leave with the next turn of the same session.
    state = await conflicts.resolveConflicts(project.id);
    assert.equal(state.session!.id, id);
    await waitIdle(id);
    assert.equal((await conflicts.conflictState(project.id)).files[1].note?.answer_sent, true);

    // The agent edits exactly the conflicted files and runs nothing but read-only git.
    session = sessions.getSession(id);
    const scope = { writable: [repo], files: (session.metadata.conflict_paths as string[]).map(f => path.join(repo, f)) };
    const call = (kind: string, title: string, file?: string): RequestPermissionRequest => ({ sessionId: 's', options: [], toolCall: { toolCallId: 't', kind: kind as 'edit', title,
      ...(file ? { locations: [{ path: file }], content: [{ type: 'diff' as const, path: file, oldText: '', newText: 'x' }] } : {}) } });
    assert.equal(permissionDecision('allow-edits', call('edit', 'Write', path.join(repo, 'a.txt')), undefined, scope, 'conflict-resolver'), 'allow');
    assert.equal(permissionDecision('allow-edits', call('edit', 'Write', 'b.txt'), undefined, scope, 'conflict-resolver'), 'allow');
    assert.equal(permissionDecision('allow-edits', call('edit', 'Write', path.join(repo, 'c.txt')), undefined, scope, 'conflict-resolver'), 'deny');
    assert.equal(permissionDecision('allow-edits', call('delete', 'Delete', path.join(repo, 'a.txt')), undefined, scope, 'conflict-resolver'), 'deny');
    assert.equal(permissionDecision('allow-edits', call('execute', 'git show :2:a.txt'), undefined, scope, 'conflict-resolver'), 'allow');
    assert.equal(permissionDecision('allow-edits', call('execute', 'git add a.txt'), undefined, scope, 'conflict-resolver'), 'deny');
    assert.equal(permissionDecision('allow-edits', call('execute', 'npm install'), undefined, scope, 'conflict-resolver'), 'deny');
    assert.equal(permissionDecision('allow-edits', call('read', 'Read a.txt'), undefined, scope, 'conflict-resolver'), 'allow');

    // The developer stages (accepts) and concludes the merge: the agent is closed.
    write('b.txt', 'main\n');
    await stage(repo, ['a.txt', 'b.txt']);
    assert.deepEqual((await conflicts.conflictState(project.id)).files.map(f => f.conflicted), [false, false]);
    git('commit', '--no-edit');
    state = await conflicts.conflictState(project.id);
    assert.equal(state.operation, null);
    assert.equal(sessions.getSession(id).status, 'complete');
    await assert.rejects(conflicts.conflictBrief(sessions.getSession(id)), /завершена/);
  } finally {
    await host.shutdownSessions();
    getDb().close(); process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
