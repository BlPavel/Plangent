import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** The ways a finish used to get stuck: a rejecting hook, a hook that rewrites files, a changed folder, a deleted task. */
test('finish recovers from rejected commits, rewriting hooks, changed files and lost tasks', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-finish-recovery-'));
  process.env.PLANGENT_DATA_DIR = path.join(folder, 'data');
  const { initializeAgentPresets } = await import('../../../core-services').then(() => import('../../../core/agents/catalog/seed'));
  initializeAgentPresets();
  const { getDb } = await import('../../../infrastructure/db/schema');
  const { initSessions, updateSession } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { createFinishService, getFinish, activeFinish, MAX_HOOK_ATTEMPTS } = await import('../../../core-services').then(() => import('../../../core/git/finish/index'));
  const { insertFinish } = await import('../../../core-services').then(() => import('../../../core/git/finish/store'));
  const { stage, commit } = await import('../../../core-services').then(() => import('../../../core/git/repo/git-write'));
  const { defaultGitSettings } = await import('../../../core-services').then(() => import('../../../core/settings/git-settings'));
  const { assertRepositoryIdle } = await import('../../../core-services').then(() => import('../../../core/git/repo/git-busy'));
  const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const db = getDb(); initSessions();
  const agent = db.prepare('SELECT id FROM agents LIMIT 1').get() as { id: string };
  const service = createFinishService({ prompt: async id => { updateSession(id, { status: 'ready' }); }, close: async () => {}, resolve: async () => ({}) as never });
  try {
    const root = path.join(folder, 'repo');
    await fs.mkdir(root); git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Developer'); git(root, 'config', 'user.email', 'developer@test.invalid');
    await fs.writeFile(path.join(root, 'a.txt'), 'base\n'); await stage(root, ['a.txt']); await commit(root, { title: 'base' }, () => defaultGitSettings);
    git(root, 'switch', '-c', 'feature/work');
    const project = createProject({ name: 'Recovery', repo_path: root, default_agent_id: agent.id });
    git(root, 'switch', 'main');
    await fs.writeFile(path.join(root, 'a.txt'), 'main change\n');
    await stage(root, ['a.txt']);
    await commit(root, { title: 'main change' }, () => defaultGitSettings);
    git(root, 'switch', 'feature/work');
    await fs.writeFile(path.join(root, 'a.txt'), 'feature change\n');
    await stage(root, ['a.txt']);
    await commit(root, { title: 'feature change' }, () => defaultGitSettings);
    assert.throws(() => git(root, 'merge', 'main'));
    const conflicted = await fs.readFile(path.join(root, 'a.txt'), 'utf8');
    assert.match(conflicted, /<<<<<<< HEAD/);
    await assert.rejects(service.start(project.id, { scenario: 'commits' }), { code: 'operation_in_progress' });
    assert.equal(activeFinish(project.id), null);
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), conflicted);
    git(root, 'merge', '--abort');
    const hooks = path.join(root, '.git', 'hooks');
    const hook = async (name: string, body: string | null) => {
      if (body === null) return fs.rm(path.join(hooks, name), { force: true });
      await fs.writeFile(path.join(hooks, name), '#!/bin/sh\n' + body, { mode: 0o755 });
    };
    // A team format rule, like husky's commit-msg: the message must start with OK.
    await hook('commit-msg', 'case "$(head -n1 "$1")" in OK*) exit 0;; esac\necho "Bad commit message: $(head -n1 "$1")" >&2\nexit 1\n');

    // 1. The agent's rejected title comes back with the hook's output, and after the last attempt the developer takes over.
    await fs.writeFile(path.join(root, 'a.txt'), 'one\n');
    const first = (await service.start(project.id, { scenario: 'commits', autoContinue: true }))!;
    for (let attempt = 1; attempt <= MAX_HOOK_ATTEMPTS; attempt++) {
      const last = attempt === MAX_HOOK_ATTEMPTS;
      await assert.rejects(service.setCommits(first.id, [{ files: ['a.txt'], title: 'bad title' }], true), error => {
        assert.match((error as Error).message, new RegExp(`attempt ${attempt} of ${MAX_HOOK_ATTEMPTS}`));
        assert.match((error as Error).message, /Bad commit message: bad title/);
        assert.match((error as Error).message, last ? /Attempts are used up/ : /call set_commits again/);
        return true;
      });
      const run = getFinish(first.id);
      assert.equal(run.status, last ? 'error' : 'running', 'the run is only parked after the last attempt');
      assert.match(run.error, /Bad commit message: bad title/);
    }
    const parked = getFinish(first.id);
    assert.deepEqual([parked.stage, parked.status], ['confirmation', 'error']);
    assert.deepEqual(parked.commits, [{ files: ['a.txt'], title: 'bad title', body: '' }], 'the proposal is kept, without a SHA');
    assert.equal(git(root, 'rev-parse', 'HEAD'), first.base_head);
    await assert.rejects(service.accept(first.id), /Сначала сохраните коммиты/);
    // An agent can never skip the hooks; the developer can, after reading why they failed.
    await assert.rejects(service.setCommits(first.id, [{ files: ['a.txt'], title: 'bad title' }], true, true, true), /Git rejected the commit/);
    const fixed = await service.setCommits(first.id, [{ files: ['a.txt'], title: 'OK fixed title' }]);
    assert.equal(fixed.status, 'waiting');
    assert.ok(fixed.commits[0].sha);
    assert.equal((await service.accept(first.id)).status, 'complete');

    // 2. The developer may commit without the hooks, explicitly.
    await fs.writeFile(path.join(root, 'a.txt'), 'two\n');
    const second = (await service.start(project.id, { scenario: 'commits', autoContinue: true }))!;
    for (let attempt = 0; attempt < MAX_HOOK_ATTEMPTS; attempt++) await assert.rejects(service.setCommits(second.id, [{ files: ['a.txt'], title: 'still bad' }], true));
    const skipped = await service.setCommits(second.id, [{ files: ['a.txt'], title: 'still bad' }], false, false, true);
    assert.equal(skipped.status, 'waiting');
    assert.equal(git(root, 'log', '-1', '--format=%s'), 'still bad');
    assert.equal((await service.accept(second.id)).status, 'complete');

    // 3. A hook that rewrites files stops the finish instead of leaving it unrecoverable; the developer adopts the result.
    await hook('commit-msg', null);
    await hook('pre-commit', 'grep -q formatted a.txt || echo formatted >> a.txt\n');
    await fs.writeFile(path.join(root, 'a.txt'), 'three\n');
    const third = (await service.start(project.id, { scenario: 'commits', autoContinue: true }))!;
    await assert.rejects(service.setCommits(third.id, [{ files: ['a.txt'], title: 'format me' }], true), /changed working files after the commit \(a\.txt\)/);
    const changed = getFinish(third.id);
    assert.deepEqual([changed.stage, changed.status, changed.hook_changes], ['confirmation', 'error', ['a.txt']]);
    assert.match(changed.error, /Хук изменил файлы/);
    const adopted = await service.adoptHookChanges(third.id);
    assert.deepEqual([adopted.status, adopted.hook_changes, adopted.commits.map(c => c.sha)], ['waiting', [], [undefined]]);
    assert.equal(git(root, 'rev-parse', 'HEAD'), third.base_head, 'the commit made before the hook finished was taken back');
    const recommitted = await service.setCommits(third.id, [{ files: ['a.txt'], title: 'format me' }]);
    assert.equal(recommitted.status, 'waiting');
    assert.equal(git(root, 'show', 'HEAD:a.txt'), 'three\nformatted', 'the commit now holds what the hook produced');
    await assert.rejects(service.adoptHookChanges(third.id), /Хук не менял файлы/);
    assert.equal((await service.accept(third.id)).status, 'complete');
    await hook('pre-commit', null);

    // 4. Files changed outside the finish: reassembling is refused without losing the cause, but taking the commits back still works.
    await fs.writeFile(path.join(root, 'a.txt'), 'four\n');
    const fourth = (await service.start(project.id, { scenario: 'commits' }))!;
    await service.setCommits(fourth.id, [{ files: ['a.txt'], title: 'four' }], true);
    await service.finishCommits(fourth.id);
    await fs.writeFile(path.join(root, 'a.txt'), 'edited meanwhile\n');
    updateFinishError(fourth.id, 'the original cause');
    await assert.rejects(service.setCommits(fourth.id, [{ files: ['a.txt'], title: 'four again' }]), /Рабочие файлы изменились/);
    assert.equal(getFinish(fourth.id).error, 'the original cause', 'a refused request does not overwrite the stored cause');
    assert.equal((await service.rollback(fourth.id)).status, 'cancelled');
    assert.equal(git(root, 'rev-parse', 'HEAD'), fourth.base_head);
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'edited meanwhile\n', 'the files are untouched');

    // 5. Cancelling never needs Git: the commits stay, the finish closes, and a new one can start.
    const fifth = (await service.start(project.id, { scenario: 'commits' }))!;
    await service.setCommits(fifth.id, [{ files: ['a.txt'], title: 'five' }], true);
    await service.finishCommits(fifth.id);
    git(root, 'switch', '-c', 'somewhere/else');
    await assert.rejects(service.rollback(fifth.id), /HEAD или ветка изменились/);
    const cancelled = await service.cancel(fifth.id);
    assert.equal(cancelled.status, 'cancelled');
    await assert.rejects(service.cancel(fifth.id), /уже закрыто/);
    assertRepositoryIdle(project.id);
    git(root, 'switch', 'feature/work');

    // 6. An agent that ends its turn without commits does not leave the run running forever; trying again needs no note.
    await fs.writeFile(path.join(root, 'a.txt'), 'six\n');
    const sixth = (await service.start(project.id, { scenario: 'commits' }))!;
    service.agentStopped(sixth.session_id!);
    assert.match(getFinish(sixth.id).error, /не создав коммиты/);
    assert.equal(getFinish(sixth.id).status, 'error');
    assert.equal((await service.revise(sixth.id, '')).status, 'running');
    await service.setCommits(sixth.id, [{ files: ['a.txt'], title: 'six' }], true);
    await service.finishCommits(sixth.id);
    assert.equal((await service.accept(sixth.id)).status, 'complete');
    assert.equal(getFinish(sixth.id).status, 'complete');
    assert.equal(git(root, 'rev-list', '--count', `${sixth.base_head}..HEAD`), '1');
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'six\n');
    assert.equal(git(root, 'status', '--porcelain'), '');

    // 7. A finish whose task is gone is not "active": it does not block anything and the next start cancels it.
    const orphan = insertFinish({ id: 'orphan', project_id: project.id, task_id: null, workspace_id: null, scenario: 'commits', options: { scenario: 'commits', task_id: 'deleted-task' },
      base_head: git(root, 'rev-parse', 'HEAD'), branch: 'feature/work', snapshot_tree: 'a'.repeat(40), stage: 'commits', status: 'error', commits: [], session_id: null, note: '',
      error: '', output: '', pushed: false, mr_url: null, mr_draft: null, hook_changes: [], created_at: '', updated_at: '' });
    assert.equal(activeFinish(project.id), null);
    assertRepositoryIdle(project.id);
    await fs.writeFile(path.join(root, 'a.txt'), 'seven\n');
    const seventh = await service.start(project.id, { scenario: 'commits' });
    assert.ok(seventh);
    assert.equal(getFinish(orphan.id).status, 'cancelled');
    await service.cancel(seventh!.id);
  } finally { db.close(); await fs.rm(folder, { recursive: true, force: true }); }

  function updateFinishError(id: string, error: string) { getDb().prepare('UPDATE finish_runs SET error=? WHERE id=?').run(error, id); }
});
