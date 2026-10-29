import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { once } from 'node:events';
test('finish commits → manual merge → confirmation → bare remote; recovery and safety', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-finish-'));
  process.env.PLANGENT_DATA_DIR = path.join(folder, 'data');
  const { getDb, migrate } = await import('../../infrastructure/db/schema');
  const { initSessions, getSession, updateSession } = await import('../agent-sessions/sessions');
  const { createProject } = await import('../projects');
  const { createLibraryItem } = await import('../library');
  const { writeItemContent } = await import('../library/library-manager');
  const { createTask, updateTask, getTask } = await import('../tasks');
  const { createFinishService, getFinish } = await import('./index');
  const { stage, commit } = await import('../code/git-write');
  const { defaultGitSettings } = await import('../projects/git-settings');
  const { generateMessage } = await import('../code/generate-message');
  const { assertRepositoryIdle } = await import('../code/git-busy');
  const { allowed } = await import('../../infrastructure/mcp/server');
  const { finishRouter } = await import('../../infrastructure/http/routes/finish');
  const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trim();
  const db = getDb(); initSessions();
  const agent = db.prepare('SELECT id FROM agents LIMIT 1').get() as { id: string };
  const prompts: string[] = [], created: { input: { title: string; description?: string; target_branch: string }; confirmed: unknown; owner?: string }[] = [];
  const service = createFinishService({ prompt: async (id, content) => { prompts.push(id); updateSession(id, { status: 'ready' }); assert.equal(content[0].type, 'text'); }, close: async () => {},
    resolve: async () => ({}) as never,
    mrs: { preview: async (_p, taskId, target) => ({ head: git(path.join(folder, 'repo'), 'rev-parse', 'HEAD'), task_id: taskId, connection_id: 'c', project_path: 'g/p', source_branch: 'feature/full', target_branch: target!, title: 'default', description: 'TEMPLATE', labels: 'x' }), create: async (_p, input, confirmed, owner) => { created.push({ input, confirmed, owner }); return { web_url: 'https://gitlab.test/mr/1' } as never; } } });
  let http: ReturnType<typeof express.application.listen> | undefined;
  try {
    const root = path.join(folder, 'repo'), remote = path.join(folder, 'remote.git');
    await fs.mkdir(root); git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Developer'); git(root, 'config', 'user.email', 'developer@test.invalid');
    await fs.writeFile(path.join(root, 'a.txt'), 'base\n'); await stage(root, ['a.txt']); await commit(root, { title: 'base' }, () => defaultGitSettings);
    const base = git(root, 'rev-parse', 'HEAD');
    git(folder, 'init', '--bare', remote); git(root, 'remote', 'add', 'origin', remote); git(root, 'push', 'origin', 'main'); git(root, 'switch', '-c', 'feature/work');
    const project = createProject({ name: 'Finish', repo_path: root, default_agent_id: agent.id, git_settings: { commit_pattern: '^TASK' } });
    const rules = createLibraryItem({ type: 'commit-rules', slug: 'commit_rules', title: 'Rules', description: '', scope: 'project', targets: [project.id], own_only: [], frontmatter: {}, agent_filter: [], enabled: true } as never);
    writeItemContent(rules, 'Use TASK prefix');
    const task = createTask({ project_id: project.id, key: 'TASK-42' });
    updateTask(task.id, { finish_scenario: 'commits', target_branch: 'main' });
    assert.equal(getTask(task.id)?.finish_scenario, 'commits'); assert.equal(getTask(task.id)?.target_branch, 'main');
    migrate(db); assert.equal(getTask(task.id)?.target_branch, 'main');
    updateTask(task.id, { finish_scenario: null, target_branch: null });
    assert.equal(getTask(task.id)?.finish_scenario, null);
    assert.throws(() => updateTask(task.id, { finish_scenario: 'invalid' as 'commits' }));
    await fs.writeFile(path.join(root, 'a.txt'), 'new\n'); await fs.writeFile(path.join(root, 'b[1].txt'), 'second\n');
    await stage(root, ['a.txt']);
    let captured = '';
    const message = await generateMessage(project.id, { includeDescription: false }, async (_p, _a, text) => { captured = text; return 'TASK fix\n\nBody\nCo-Authored-By: Claude <robot@anthropic.com>'; });
    assert.equal(message.body, ''); assert.match(captured, /Use TASK prefix/); assert.match(captured, /diff --git/);
    assert.equal(await service.start(project.id, { scenario: 'nothing' }), null);
    await assert.rejects(service.start(project.id, { scenario: 'full' }), /целевую/);
    const first = await service.start(project.id, { scenario: 'push', targetBranch: 'main', includeDescription: true });
    assert.ok(first); const id = first.id;
    assert.throws(() => assertRepositoryIdle(project.id), /завершение/);
    await assert.rejects(service.start(project.id, { scenario: 'commits' }), /завершение/);
    assert.deepEqual(allowed(getSession(getFinish(id).session_id!)), ['get_finish_context', 'set_commits', 'finish_commits']);
    const proposed = [{ files: ['a.txt'], title: 'TASK first', body: 'Co-Authored-By: Claude <noreply@anthropic.com>' }, { files: ['b[1].txt'], title: 'TASK second' }];
    await assert.rejects(service.setCommits(id, proposed.slice(0,1), true), /не включены/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), base);
    await assert.rejects(service.accept(id));
    await service.setCommits(id, proposed, true);
    assert.equal(Number(git(root, 'rev-list', '--count', base + '..HEAD')), 2);
    assert.doesNotMatch(git(root, 'log', base + '..HEAD', '--format=%B'), /Claude|Co-Authored/);
    assert.equal((await service.finishCommits(id)).status, 'waiting');
    await service.setCommits(id, [{ files: ['a.txt', 'b[1].txt'], title: 'TASK combined' }]);
    assert.equal(Number(git(root, 'rev-list', '--count', base + '..HEAD')), 1);
    await service.setCommits(id, [{ files: ['b[1].txt'], title: 'TASK split b' }, { files: ['a.txt'], title: 'TASK split a' }]);
    assert.equal(Number(git(root, 'rev-list', '--count', base + '..HEAD')), 2);
    await service.revise(id, 'Keep one commit');
    assert.equal(new Set(prompts).size, 1, 'Revision must reuse the same session');
    await service.setCommits(id, [{ files: ['a.txt', 'b[1].txt'], title: 'TASK approved' }], true);
    await service.finishCommits(id);
    assert.equal((await service.accept(id)).status, 'complete');
    assert.equal(git(remote, 'rev-parse', 'refs/heads/feature/work'), git(root, 'rev-parse', 'HEAD'));
    assert.equal(git(root, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/feature/work');
    assertRepositoryIdle(project.id);

    await fs.writeFile(path.join(root, 'a.txt'), 'external case\n');
    const second = (await service.start(project.id, { scenario: 'commits' }))!;
    await service.setCommits(second.id, [{ files: ['a.txt'], title: 'TASK draft' }], true);
    await service.finishCommits(second.id);
    await fs.writeFile(path.join(root, 'external'), 'external\n'); git(root, 'add', 'external'); git(root, 'commit', '-m', 'external');
    await assert.rejects(service.setCommits(second.id, [{ files: ['a.txt'], title: 'TASK redo' }]), /HEAD/);
    const workflowHead = getFinish(second.id).commits.at(-1)!.sha!;
    git(root, 'reset', '--mixed', workflowHead); await fs.unlink(path.join(root, 'external'));
    git(root, 'push', 'origin', 'HEAD');
    await assert.rejects(service.setCommits(second.id, [{ files: ['a.txt'], title: 'TASK redo' }]), /опубликованы/);
    await assert.rejects(service.rollback(second.id), /опубликованы/);
    db.prepare("UPDATE finish_runs SET status='complete' WHERE id=?").run(second.id);

    await fs.writeFile(path.join(root, 'a.txt'), 'rollback\n');
    const third = (await service.start(project.id, { scenario: 'commits', includeCoauthors: true, coauthors: [{ name: 'Colleague', email: 'colleague@test.invalid' }] }))!;
    const rollbackBase = third.base_head;
    await service.setCommits(third.id, [{ files: ['a.txt'], title: 'TASK human' }], true); await service.finishCommits(third.id);
    assert.match(git(root, 'log', '-1', '--format=%B'), /Co-authored-by: Colleague/);
    assert.equal((await service.rollback(third.id)).status, 'cancelled');
    assert.equal(git(root, 'rev-parse', 'HEAD'), rollbackBase);
    assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'rollback\n');

    const full = (await service.start(project.id, { scenario: 'full', targetBranch: 'feature/work', branchName: 'feature/full' }))!;
    assert.equal(git(root, 'branch', '--show-current'), 'feature/full');
    assert.equal(full.base_head, rollbackBase);
    await service.setCommits(full.id, [{ files: ['a.txt'], title: 'TASK full' }], true);
    await assert.rejects(service.finishCommits(full.id), /set_merge_request/);
    assert.ok(allowed(getSession(getFinish(full.id).session_id!)).includes('set_merge_request'));
    await assert.rejects(service.setMergeRequest(full.id, 'two'+String.fromCharCode(10)+'lines', 'x'), /одна/);
    await service.setMergeRequest(full.id, 'draft', 'Черновик');
    await service.finishCommits(full.id);
    assert.deepEqual(getFinish(full.id).mr_draft, { title: 'draft', description: 'Черновик' });
    // The user edits the text while confirming; nothing is created or pushed before accept.
    await service.setMergeRequest(full.id, ' TASK-1 title ', 'Описание');
    assert.equal(created.length, 0);
    const accepted = await service.accept(full.id);
    assert.deepEqual([accepted.stage, accepted.status, accepted.pushed, accepted.mr_url], ['done', 'complete', true, 'https://gitlab.test/mr/1']);
    await assert.rejects(service.setMergeRequest(full.id, 'late', 'x'), /до подтверждения/);
    assert.equal(created[0].input.description, 'Описание');
    assert.deepEqual([created[0].input.title, created[0].input.target_branch, created[0].confirmed, created[0].owner], ['TASK-1 title', 'feature/work', true, full.id]);
    assert.ok(!allowed(getSession(getFinish(first.id).session_id!)).includes('set_merge_request'));
    const noHost = createFinishService({ resolve: async () => { throw new Error('нет подключения'); } });
    await assert.rejects(noHost.start(project.id, { scenario: 'full', targetBranch: 'main' }), /хостингу.*нет подключения/);
    assert.equal(git(remote, 'rev-parse', 'refs/heads/feature/full'), git(root, 'rev-parse', 'HEAD'));

    await assert.rejects(service.start(project.id, { scenario: 'commits', autoContinue: 'false' as never }), /Invalid autoContinue/);
    for (const scenario of ['commits', 'push', 'full'] as const) {
      await fs.writeFile(path.join(root, 'a.txt'), 'automatic ' + scenario + '\n');
      const beforeMrs: number = created.length;
      const automatic = (await service.start(project.id, { scenario, targetBranch: 'main', autoContinue: true }))!;
      assert.equal(automatic.options.autoContinue, true);
      await service.setCommits(automatic.id, [{ files: ['a.txt'], title: 'TASK automatic ' + scenario }], true);
      if (scenario === 'full') {
        await assert.rejects(service.finishCommits(automatic.id), /set_merge_request/);
        assert.equal(created.length, beforeMrs);
        await service.setMergeRequest(automatic.id, 'TASK automatic MR', 'Automatic description');
      }
      const result = await service.finishCommits(automatic.id);
      assert.equal(result.stage, 'done');
      assert.equal(result.status, 'complete');
      assert.equal(result.pushed, scenario !== 'commits');
      assert.equal(created.length, beforeMrs + (scenario === 'full' ? 1 : 0));
      if (scenario !== 'commits') assert.equal(git(remote, 'rev-parse', 'refs/heads/feature/full'), git(root, 'rev-parse', 'HEAD'));
      assertRepositoryIdle(project.id);
    }
    await fs.writeFile(path.join(root, 'a.txt'), 'automatic push retry\n');
    const retry = (await service.start(project.id, { scenario: 'push', autoContinue: true }))!;
    await service.setCommits(retry.id, [{ files: ['a.txt'], title: 'TASK retry automatic push' }], true);
    git(root, 'remote', 'set-url', 'origin', path.join(folder, 'missing.git'));
    await assert.rejects(service.finishCommits(retry.id));
    assert.equal(getFinish(retry.id).stage, 'push');
    assert.equal(getFinish(retry.id).status, 'error');
    git(root, 'remote', 'set-url', 'origin', remote);
    assert.equal((await service.accept(retry.id)).status, 'complete');

    const app = express(); app.use(express.json()); app.use('/api/projects/:projectId/finish', finishRouter);
    http = app.listen(0, '127.0.0.1'); await once(http, 'listening');
    const port = (http.address() as { port: number }).port;
    const response = await fetch('http://127.0.0.1:' + port + '/api/projects/' + project.id + '/finish');
    assert.equal(response.status, 200); assert.equal(await response.json(), null);
    // Additive migration preserves historical finish data.
    migrate(db); assert.equal(getFinish(third.id).status, 'cancelled');
  } finally { if (http) await new Promise<void>(resolve => http!.close(() => resolve())); db.close(); await fs.rm(folder, { recursive: true, force: true }); }
});
