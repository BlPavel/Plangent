import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-task-workspaces-'));
process.env.PLANGENT_DATA_DIR = path.join(temporary, 'data');

test('workspace migration on fresh and existing databases', async () => {
  const { migrate } = await import('../../infrastructure/db/schema');
  for (const existing of [false, true]) {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      if (existing) {
        migrate(db);
        db.exec('DROP TABLE workspaces');
      }
      migrate(db);
      db.exec(`INSERT INTO projects(id,name,repo_path,kind) VALUES ('p','P','/p','project'),('g','G','/g','group');
        INSERT INTO tasks(id,project_id,key) VALUES ('t','p','T'),('t2','p','T2'),('gt','g','G');`);
      const insert = db.prepare(`INSERT INTO workspaces(id,project_id,task_id,branch,base_branch,path,status) VALUES (?,?,?,?, 'main','/w','ready')`);
      insert.run('w', 'p', 't', 'feature');
      assert.throws(() => insert.run('w2', 'p', 't2', 'feature'), /UNIQUE/);
      assert.throws(() => insert.run('w2', 'p', 't', 'other'), /UNIQUE/);
      assert.throws(() => insert.run('gw', 'g', 'gt', 'group'), /ordinary project/);
      assert.throws(() => insert.run('gw', 'p', 'gt', 'group'), /ordinary project/);
      migrate(db);
      assert.equal((db.prepare('SELECT status FROM workspaces WHERE id=?').get('w') as { status: string }).status, 'ready');
      db.exec("UPDATE workspaces SET status='removed' WHERE id='w'");
      insert.run('w2', 'p', 't', 'feature');
      assert.deepEqual(db.pragma('foreign_key_check'), []);
    } finally { db.close(); }
  }
});

test('workspace lifecycle, preparation, roots, permissions and library', async t => {
  // All mutating Git commands in this test are confined to disposable repositories.
  const git = (cwd: string, ...args: string[]) => {
    assert.ok(path.relative(temporary, cwd) && !path.relative(temporary, cwd).startsWith('..'));
    return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  };
  const { getDb } = await import('../../infrastructure/db/schema');
  const projects = await import('../projects');
  const tasks = await import('../tasks');
  const workspaces = await import('./index');
  const { prepareWorkspace, runSetupCommand, copyWorkspaceFiles } = await import('./prepare');
  const { createSession, initSessions } = await import('../agent-sessions/sessions');
  const { permissionDecision } = await import('../agent-sessions/permissions');
  const { validateGitSettings } = await import('../projects/git-settings');
  initSessions();
  let n = 0;
  function fixture() {
    const prefix = path.join(temporary, String(++n));
    fs.mkdirSync(prefix);
    const remote = path.join(prefix, 'origin.git');
    git(prefix, 'init', '--bare', remote);
    const repo = path.join(prefix, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.name', 'Workspace Test');
    git(repo, 'config', 'user.email', 'workspace@example.invalid');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'base');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.env\nsetup.txt\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'Initial fixture');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-u', 'origin', 'main');
    const project = projects.createProject({ name: 'Workspace ' + n, repo_path: repo });
    const task = tasks.createTask({ project_id: project.id, key: 'T-' + n });
    return { repo, project, task };
  }
  try {
    await t.test('create a new branch, reuse a free branch, reserve branches and recreate', async () => {
      const { repo, project, task } = fixture();
      assert.equal(workspaces.rootForTask(task.id), repo);
      assert.throws(() => workspaces.workspaceFolder(project.id, '../escape'));
      const created = await workspaces.createWorkspace(task.id, { branch: 'feature/new', base: 'main' });
      assert.equal(created.status, 'ready');
      assert.equal(git(created.path, 'branch', '--show-current'), 'feature/new');
      assert.equal(git(repo, 'branch', '--show-current'), 'main');
      assert.equal(workspaces.rootForTask(task.id), created.path);
      const other = tasks.createTask({ project_id: project.id, key: 'Other' });
      await assert.rejects(workspaces.createWorkspace(other.id, { branch: 'feature/new', base: 'main' }), /already|уже/);
      await assert.rejects(workspaces.createWorkspace(other.id, { branch: 'main', base: 'main' }), /уже/);
      const recreated = await workspaces.recreateWorkspace(created.id);
      assert.equal(recreated.branch, created.branch);
      assert.equal(recreated.status, 'ready');
      await workspaces.removeWorkspace(recreated.id);
      assert.equal(workspaces.rootForTask(task.id), repo);
      assert.ok(git(repo, 'show-ref', '--verify', 'refs/heads/feature/new'));
      const reused = await workspaces.createWorkspace(task.id, { branch: 'feature/new', base: 'main' });
      assert.equal(reused.status, 'ready');
    });
    await t.test('dirty and unpushed work is listed; discard is explicit; recreation keeps commits', async () => {
      const { task, repo } = fixture();
      const created = await workspaces.createWorkspace(task.id, { branch: 'feature/dirty', base: 'main' });
      fs.writeFileSync(path.join(created.path, 'tracked.txt'), 'change');
      fs.writeFileSync(path.join(created.path, 'new.txt'), 'new');
      await assert.rejects(workspaces.removeWorkspace(created.id), (error: unknown) => error instanceof workspaces.WorkspaceRemovalError && error.blockers.files.length === 2);
      git(created.path, 'add', '.');
      git(created.path, 'commit', '-m', 'Unpushed fixture');
      const head = git(created.path, 'rev-parse', 'HEAD');
      assert.deepEqual((await workspaces.removalBlockers(created.id)).commits, [head]);
      await assert.rejects(workspaces.removeWorkspace(created.id), workspaces.WorkspaceRemovalError);
      const recreated = await workspaces.recreateWorkspace(created.id, { discard: true });
      assert.equal(git(recreated.path, 'rev-parse', 'HEAD'), head);
      await workspaces.removeWorkspace(recreated.id, { discard: true });
      assert.equal(workspaces.activeWorkspace(task.id), null);
      assert.equal(git(repo, 'branch', '--list', 'feature/dirty'), '');
    });
    await t.test('new work starts from fetched origin base and preserves main-folder edits', async () => {
      const { repo, task } = fixture();
      const writer = path.join(path.dirname(repo), 'writer');
      git(path.dirname(repo), 'clone', '--branch', 'main', git(repo, 'remote', 'get-url', 'origin'), writer);
      fs.writeFileSync(path.join(writer, 'tracked.txt'), 'remote update');
      git(writer, 'add', '.');
      git(writer, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Remote update');
      git(writer, 'push', 'origin', 'main');
      fs.writeFileSync(path.join(repo, 'tracked.txt'), 'main folder edit');
      const created = await workspaces.createWorkspace(task.id, { branch: 'feature/fresh', base: 'main' });
      assert.equal(git(created.path, 'rev-parse', 'HEAD'), git(writer, 'rev-parse', 'HEAD'));
      assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'main folder edit');
    });
    await t.test('library instructions are prepared and updated in active worktrees', async () => {
      const { project, task, repo } = fixture();
      const library = await import('../library');
      const { writeItemContent } = await import('../library/library-manager');
      const { syncItem, unsyncItem, syncAll } = await import('../library/syncer');
      const item = library.createLibraryItem({ type: 'main', slug: 'workspace-test', title: 'Workspace instructions', scope: 'project', targets: [project.id] });
      writeItemContent(item, 'Initial instructions');
      syncItem(item);
      const created = await workspaces.createWorkspace(task.id, { branch: 'feature/library', base: 'main' });
      assert.match(fs.readFileSync(path.join(created.path, 'AGENTS.md'), 'utf8'), /Initial instructions/);
      writeItemContent(item, 'Updated instructions');
      syncAll();
      for (const root of [repo, created.path]) assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /Updated instructions/);
      unsyncItem(item);
      for (const root of [repo, created.path]) assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
    });
    await t.test('copy globs, command, failure, readiness gate and session permissions', async () => {
      const { repo, project, task } = fixture();
      fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=fixture');
      projects.updateProject(project.id, { git_settings: { workspace_copy_files: ['.env'],
        workspace_setup_command: 'node -e "require(\'fs\').writeFileSync(\'setup.txt\',process.env.SETUP_VALUE);console.log(\'setup complete\')"' }, config: { extra_env: { SETUP_VALUE: 'configured' } } });
      const created = await workspaces.createWorkspace(task.id, { branch: 'feature/setup', base: 'main' });
      assert.equal(created.status, 'ready');
      assert.equal(fs.readFileSync(path.join(created.path, '.env'), 'utf8'), 'TOKEN=fixture');
      assert.equal(fs.readFileSync(path.join(created.path, 'setup.txt'), 'utf8'), 'configured');
      assert.match(created.setup_log, /setup complete/);
      assert.match(created.setup_log, /Copied/);
      const { listAgents } = await import('../agents');
      const session = createSession({ project_id: project.id, task_id: task.id, agent_id: listAgents()[0].id, role: 'executor', policy: 'allow-edits' });
      assert.equal(await workspaces.rootForSession(session), created.path);
      const roots = await workspaces.writableRootsForSession(session);
      assert.deepEqual(roots, [created.path, path.join(repo, '.plangent', task.key)]);
      const decision = (file: string) => permissionDecision('allow-edits', { sessionId: session.id, options: [], toolCall: { toolCallId: 'test', title: 'edit', kind: 'edit', locations: [{ path: file }] } }, [], { writable: roots, restrictWrites: true });
      assert.equal(decision(path.join(created.path, 'tracked.txt')), 'allow');
      assert.equal(decision(path.join(repo, 'tracked.txt')), 'deny');
      assert.equal(decision(path.join(repo, '.plangent', task.key, 'plan.md')), 'allow');
      assert.equal(decision(path.join(repo, '.plangent', 'Other', 'plan.md')), 'deny');
      projects.updateProject(project.id, { git_settings: { workspace_setup_command: 'node -e "process.exit(7)"' } });
      assert.equal((await prepareWorkspace(created.id)).status, 'failed');
      assert.throws(() => workspaces.assertTaskWorkspaceReady(task.id), /code 7/);
      await assert.rejects(runSetupCommand('node -e "setInterval(()=>{},1000)"', created.path, process.env, () => {}, 100), /timed out/);
      const abort = new AbortController();
      abort.abort();
      await assert.rejects(async () => runSetupCommand('node -e ""', created.path, process.env, () => {}, 1000, abort.signal));
      assert.throws(() => validateGitSettings({ workspace_copy_files: ['../outside'] }));
      const outside = path.join(temporary, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret'), 'outside');
      fs.symlinkSync(outside, path.join(repo, 'linked'), 'junction');
      await assert.rejects(copyWorkspaceFiles(repo, created.path, ['linked/**'], () => {}), /links/);
      await copyWorkspaceFiles(repo, created.path, ['.env*'], () => {});
      fs.mkdirSync(path.join(repo, 'configs', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'configs', 'a.json'), '{}');
      fs.writeFileSync(path.join(repo, 'configs', 'nested', 'b.json'), '{}');
      fs.writeFileSync(path.join(repo, 'configs', 'nested', 'skip.txt'), 'skip');
      await copyWorkspaceFiles(repo, created.path, ['configs/**/*.json'], () => {});
      assert.ok(fs.existsSync(path.join(created.path, 'configs', 'a.json')));
      assert.ok(fs.existsSync(path.join(created.path, 'configs', 'nested', 'b.json')));
      assert.ok(!fs.existsSync(path.join(created.path, 'configs', 'nested', 'skip.txt')));
    });
    await t.test('group tasks keep their existing roots and cannot get worktrees', async () => {
      const group = projects.createProject({ kind: 'group', name: 'Group' });
      const task = tasks.createTask({ project_id: group.id, key: 'GROUP-1' });
      assert.equal(workspaces.rootForTask(task.id), group.repo_path);
      await assert.rejects(workspaces.createWorkspace(task.id, { branch: 'feature/group', base: 'main' }), /ordinary project/);
    });
  } finally {
    getDb().close();
    // The test owns this exact temporary folder, never the active repository.
    assert.ok(temporary.startsWith(path.join(os.tmpdir(), 'plangent-task-workspaces-')));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
