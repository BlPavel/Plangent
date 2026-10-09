import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { parseRemoteUrl, sameRemote } from './remote-url';
import { resolveGitSettings, defaultGitSettings, validateGitSettings } from './git-settings';

test('remote normalization: nested paths, SSH, HTTPS, ports, credentials and invalid values', () => {
  assert.equal(parseRemoteUrl('git@git.example:group/sub/repo.git')?.projectPath, 'group/sub/repo');
  assert.equal(parseRemoteUrl('ssh://git@git.example:2222/group/repo.git')?.port, '2222');
  assert.ok(sameRemote('git@git.example:group/repo.git', 'https://git.example/group/repo'));
  assert.equal(parseRemoteUrl('https://user:secret@git.example/group/repo.git')?.normalized, 'git.example/group/repo');
  assert.equal(parseRemoteUrl('ext::command'), null);
  assert.equal(parseRemoteUrl('ssh://git@[::1]:2222/group/repo.git')?.host, '[::1]');
  assert.equal(parseRemoteUrl('C:\\repo'), null);
});
test('git settings: per-field provenance, false/empty overrides, regex validation and defaults', () => {
  const result = resolveGitSettings({ base_branch: 'main', include_description: true }, { include_description: false, base_branch: '' });
  assert.equal(result.values.base_branch, ''); assert.equal(result.values.include_description, false);
  assert.equal(result.sources.branch_prefixes, 'default'); assert.equal(result.sources.include_description, 'project');
  assert.equal(resolveGitSettings({ base_branch: 'main' }).sources.base_branch, 'group');
  assert.throws(() => validateGitSettings({ commit_pattern: '[' }));
  assert.throws(() => validateGitSettings({ unknown: true }));
  assert.throws(() => validateGitSettings({ forbidden_patterns: ['['] }));
  assert.throws(() => validateGitSettings({ include_description: 'false' }));
  assert.equal(defaultGitSettings.finish_scenario, 'nothing');
});
test('project storage, clone conflicts/cleanup, busy guards and HTTP commit validation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-git-projects-'));
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb, migrate } = await import('../../infrastructure/db/schema');
  const { createProject, createProjectFromFolder, updateProject, getProject, effectiveGitSettings, ExistingCloneError, inspectProjectGit } = await import('./index');
  const { initSessions } = await import('../agent-sessions/sessions');
  const { assertRepositoryIdle } = await import('../code/git-busy');
  const { gitRouter } = await import('../../infrastructure/http/routes/git');
  const { projectsRouter } = await import('../../infrastructure/http/routes/projects');
  const { stage, commit } = await import('../code/git-write');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  let server: ReturnType<typeof express.application.listen> | undefined;
  try {
    const db = getDb(); migrate(db); initSessions();
    const { default: Database } = await import('better-sqlite3');
    const legacy = new Database(':memory:');
    legacy.exec("CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,repo_path TEXT NOT NULL,default_agent_id TEXT,config TEXT NOT NULL DEFAULT '{}',hide_from_git INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (datetime('now'))); INSERT INTO projects (id,name,repo_path) VALUES ('legacy','Legacy','/legacy')");
    try {
      migrate(legacy); migrate(legacy);
      const row = legacy.prepare("SELECT repo_path,clone_url,git_settings FROM projects WHERE id='legacy'").get() as { repo_path: string; clone_url: string; git_settings: string };
      assert.deepEqual(row, { repo_path: '/legacy', clone_url: '', git_settings: '{}' });
    } finally { legacy.close(); }

    const group = createProject({ kind: 'group', name: 'Group', git_settings: { base_branch: 'main', include_description: true } });
    const repo = path.join(root, 'source'); await fs.mkdir(repo); git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Human'); git(repo, 'config', 'user.email', 'human@example.invalid');
    await fs.writeFile(path.join(repo, 'file'), 'initial'); await stage(repo, ['file']); await commit(repo, { title: 'initial' }, () => defaultGitSettings);
    const destination = path.join(root, 'clone');
    const project = await createProjectFromFolder({ name: 'Clone', repo_path: destination, clone_url: repo, group_id: group.id, git_settings: { include_description: false } }, true);
    assert.equal(project.clone_url, repo); assert.equal(effectiveGitSettings(project.id).values.base_branch, 'main');
    assert.equal(effectiveGitSettings(project.id).values.include_description, false);
    updateProject(project.id, { git_settings: {} }); assert.equal(effectiveGitSettings(project.id).values.include_description, true);
    assert.equal(getProject(project.id)?.repo_path, destination);
    migrate(db); assert.equal(getProject(project.id)?.clone_url, repo);
    await assert.rejects(createProjectFromFolder({ name: 'Duplicate', repo_path: destination }), /Clone/);
    // A matching unregistered clone offers explicit reuse and never removes it.
    const existing = path.join(root, 'existing'); git(root, 'clone', repo, existing);
    await assert.rejects(createProjectFromFolder({ name: 'Existing', repo_path: existing, clone_url: repo }, true), ExistingCloneError);
    assert.ok(await fs.stat(existing));
    const reused = await createProjectFromFolder({ name: 'Existing', repo_path: existing, clone_url: repo }, true, { reuseExisting: true }); assert.equal(reused.repo_path, existing);
    const nonrepo = path.join(root, 'nonrepo'); await fs.mkdir(nonrepo); await fs.writeFile(path.join(nonrepo, 'keep'), 'keep');
    await assert.rejects(createProjectFromFolder({ name: 'Conflict', repo_path: nonrepo, clone_url: repo }, true), /already exists/); assert.equal(await fs.readFile(path.join(nonrepo, 'keep'), 'utf8'), 'keep');
    const failed = path.join(root, 'failed'); await assert.rejects(createProjectFromFolder({ name: 'Failed', repo_path: failed, clone_url: path.join(root, 'missing') }, true));
    await assert.rejects(fs.stat(failed));
    const cancelled = path.join(root, 'cancelled'), abort = new AbortController(); abort.abort();
    await assert.rejects(createProjectFromFolder({ name: 'Cancelled', repo_path: cancelled, clone_url: repo }, true, { signal: abort.signal }));
    await assert.rejects(fs.stat(cancelled));
    const other = path.join(root, 'other'); git(root, 'clone', repo, other); git(other, 'remote', 'set-url', 'origin', 'git@other.example:different/repo.git');
    await assert.rejects(createProjectFromFolder({ name: 'Wrong remote', repo_path: other, clone_url: repo }, true, { reuseExisting: true }), /different repository/);
    const plain = await createProjectFromFolder({ name: 'Plain', repo_path: nonrepo }); assert.equal(plain.clone_url, '');
    const app = express(); app.use(express.json()); app.use('/api/projects/:projectId/git', gitRouter); app.use('/api/projects', projectsRouter);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    const post = (url: string, body: unknown) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const api = '/api/projects/' + project.id + '/git';
    await fs.writeFile(path.join(destination, 'file'), 'changed');
    assert.equal((await post(api + '/stage', { paths: ['file'] })).status, 200);
    const agent = db.prepare('SELECT id FROM agents LIMIT 1').get() as { id: string };
    db.prepare("INSERT INTO agent_sessions (id,project_id,agent_id,role,title,status,policy) VALUES ('busy',?,?, 'executor','Busy','thinking','allow-all')").run(group.id, agent.id);
    assert.throws(() => assertRepositoryIdle(project.id), /выполнение/);
    for (const endpoint of ['/commit', '/pull', '/switch']) assert.equal((await post(api + endpoint, { title: 'fix', branch: 'main' })).status, 409);
    db.prepare("UPDATE agent_sessions SET status='complete' WHERE id='busy'").run();
    assert.equal((await post(api + '/commit', { title: 'Generated with Claude Code' })).status, 409);
    assert.equal((await post(api + '/commit', { title: 'Generated with Claude Code', overrideForbidden: true })).status, 200);
    await fs.writeFile(path.join(destination, 'file'), 'changed again'); await post(api + '/stage', { paths: ['file'] });
    updateProject(project.id, { git_settings: { commit_pattern: '^TASK-' } });
    // Team format is a warning; the same check drives the client's yellow highlight.
    const check = await (await post(api + '/commit-message', { title: 'fix' })).json() as { violations: { kind: string }[] }; assert.equal(check.violations[0].kind, 'format');
    assert.equal((await post(api + '/commit', { title: 'fix' })).status, 200);
    await fs.writeFile(path.join(destination, 'file'), 'TASK change'); await post(api + '/stage', { paths: ['file'] });
    const trailerCheck = await (await post(api + '/commit-message', { title: 'TASK-1: fix', body: 'Co-Authored-By: Claude <robot@anthropic.com>', includeDescription: true })).json() as { violations: { kind: string }[] };
    assert.ok(trailerCheck.violations.some(v => v.kind === 'forbidden'));
    assert.equal((await post(api + '/commit', { title: 'TASK-1: fix' })).status, 200);
    assert.equal((await fetch(base + api + '/branches', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const { saveConnection } = await import('../integrations');
    const connection = saveConnection({ name: 'Git hosting', base_url: 'https://git.example', auth_strategy: 'basic', auth_config: { check_path: '/api/v4/user' } });
    git(repo, 'remote', 'add', 'origin', 'git@git.example:group/sub/repo.git');
    const preview = await inspectProjectGit(repo);
    assert.equal(preview.connection_id, connection.id); assert.equal(preview.host_project_path, 'group/sub/repo');
    const metadataProject = await createProjectFromFolder({ name: 'Metadata', repo_path: repo });
    assert.equal(metadataProject.connection_id, connection.id);
    updateProject(metadataProject.id, { connection_id: null }); assert.equal(getProject(metadataProject.id)?.connection_id, null);
    saveConnection({ name: 'Another hosting connection', base_url: 'https://git.example:8443', auth_strategy: 'basic', auth_config: { check_path: '/api/v4/user' } });
    assert.equal((await inspectProjectGit(repo)).connection_id, null);
    assert.equal((await inspectProjectGit(nonrepo)).repository, false);
    const settings = await (await fetch(base + '/api/projects/' + project.id + '/git-settings')).json() as { sources: Record<string,string> }; assert.equal(settings.sources.commit_pattern, 'project');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    getDb().close(); await fs.rm(root, { recursive: true, force: true });
  }
});
