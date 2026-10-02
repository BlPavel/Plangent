import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('groups, sources and sharing: keys, catalog, library targets and moving tasks', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-workspace-test-'));
  process.env.PLANGENT_DATA_DIR = path.join(temp, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const projects = await import('./index');
  const { referenceCatalog, workspaceBriefing, writableRoots } = await import('./workspace');
  const library = await import('../library');
  const { resolvePlanTemplate } = await import('../library/plan-template');
  const { writeItemContent } = await import('../library/library-manager');
  const { initSessions } = await import('../agent-sessions/sessions');
  const { initQueues } = await import('../orchestration/queue');
  const { createTask, getTask } = await import('../tasks');
  const { moveTask } = await import('../orchestration/task-move');
  const { stopWatchPlanFile } = await import('../orchestration/plan-file');
  const { stopWatchAnalysis } = await import('../orchestration/task-files');
  initSessions();
  initQueues();
  const dir = (name: string) => { const p = path.join(temp, name); fs.mkdirSync(p, { recursive: true }); return p; };
  try {
    const group = projects.createProject({ kind: 'group', name: 'Микрофронты' });
    assert.equal(group.key, null);
    assert.ok(fs.existsSync(path.join(group.repo_path, 'README.md')));
    const orders = projects.createProject({ name: 'Заказы', repo_path: dir('orders'), group_id: group.id });
    const profile = projects.createProject({ name: 'Profile', repo_path: dir('profile'), group_id: group.id });
    assert.equal(orders.key, 'zakazy');
    assert.throws(() => projects.createProject({ name: 'Other', key: 'zakazy', repo_path: dir('other') }), /уже занят/);
    assert.throws(() => projects.createProject({ kind: 'source', name: 'Dup', repo_path: orders.repo_path }), /@zakazy/);
    assert.match(fs.readFileSync(path.join(group.repo_path, 'README.md'), 'utf8'), /@zakazy/);
    assert.deepEqual(writableRoots(group), [group.repo_path, profile.repo_path, orders.repo_path]);

    const uiKit = projects.createProject({ kind: 'source', name: 'UI kit', key: 'ui-kit', repo_path: dir('ui-kit'), description: 'Компоненты', targets: [group.id] });
    const docs = projects.createProject({ kind: 'source', name: 'Docs', key: 'docs', repo_path: dir('docs'), targets: [] });
    const solo = projects.createProject({ name: 'Solo', repo_path: dir('solo') });
    // Neighbours and sources shared with the group; nothing for an unrelated project.
    assert.deepEqual(referenceCatalog(orders).map(r => r.key), ['profile', 'ui-kit']);
    assert.deepEqual(referenceCatalog(solo).map(r => r.key), []);
    projects.updateProject(docs.id, { config: { available_everywhere: true } });
    assert.deepEqual(referenceCatalog(solo).map(r => r.key), ['docs']);
    assert.match(workspaceBriefing(group), /@profile[\s\S]*@zakazy/);
    assert.doesNotMatch(workspaceBriefing(orders), /Компоненты[\s\S]*Компоненты/);

    // A plan template shared with the group applies to its projects, a direct one wins.
    const groupTemplate = library.createLibraryItem({ type: 'plan-template', slug: 'g-tpl', title: 'g', scope: 'project', targets: [group.id] });
    writeItemContent(groupTemplate, 'GROUP');
    assert.equal(resolvePlanTemplate(orders.id), 'GROUP');
    assert.equal(resolvePlanTemplate(solo.id), '');
    const own = library.createLibraryItem({ type: 'plan-template', slug: 'o-tpl', title: 'o', scope: 'project', targets: [orders.id] });
    writeItemContent(own, 'OWN');
    assert.equal(resolvePlanTemplate(orders.id), 'OWN');
    assert.deepEqual(library.libraryItemsFor(profile).map(i => i.origin), ['group']);

    // Tasks move between the group and its projects; same keys may exist in different projects.
    const task = createTask({ project_id: group.id, key: 'MF-1' });
    createTask({ project_id: profile.id, key: 'MF-1' });
    await assert.rejects(moveTask(task.id, profile.id), /уже есть задача/);
    await assert.rejects(moveTask(task.id, solo.id), /только между группой/);
    fs.mkdirSync(path.join(group.repo_path, '.plangent', 'MF-1'), { recursive: true });
    fs.writeFileSync(path.join(group.repo_path, '.plangent', 'MF-1', 'note.md'), 'x');
    await moveTask(task.id, orders.id);
    assert.equal(getTask(task.id)!.project_id, orders.id);
    assert.ok(fs.existsSync(path.join(orders.repo_path, '.plangent', 'MF-1', 'note.md')));
    assert.ok(!fs.existsSync(path.join(group.repo_path, '.plangent', 'MF-1')));
    stopWatchPlanFile(task.id);
    stopWatchAnalysis(task.id);

    // Deleting the group keeps its projects.
    projects.deleteProject(group.id);
    assert.equal(projects.getProject(orders.id)!.group_id, null);
    assert.ok(!fs.existsSync(group.repo_path));
    assert.deepEqual(projects.getProject(uiKit.id)!.targets, []);
  } finally { getDb().close(); }
});
