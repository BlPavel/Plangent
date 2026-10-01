import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('analysis persistence, task files, disk sync and write policy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-analysis-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { createTask, getTask, updateTask, deleteTask } = await import('../tasks');
  const analysis = await import('./analysis');
  const files = await import('./task-files');
  const plans = await import('./plan-file');
  const { createPlan, getLatestPlan } = await import('./plans');
  const { initQueues, getQueue, saveQueue } = await import('./queue');
  const { initSessions, createSession, updateSession } = await import('../agent-sessions/sessions');
  const { initTaskFiles } = await import('./task-files-startup');
  initSessions();
  initQueues();
  const project = createProject({ name: 'Test', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'TEST', description: 'Legacy description' });
  async function until(check: () => boolean) {
    const deadline = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('Timed out');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
  try {
    assert.equal(analysis.listAnalysisSections(task.id).length, 1);
    assert.equal(analysis.listAnalysisSections(task.id)[0].title, 'Описание задачи');
    assert.equal(getTask(task.id)!.description, null);
    const plan = createPlan({ task_id: task.id, content: '- [ ] (p1) Original' });
    const old = path.join(root, '.plangent', 'TEST.plan.md');
    fs.writeFileSync(old, '- [ ] (p1) From IDE');
    initTaskFiles();
    assert.equal(fs.existsSync(old), false);
    assert.match(getLatestPlan(task.id)!.content, /From IDE/);
    assert.equal(analysis.listAnalysisSections(task.id).length, 1);
    await new Promise(resolve => setTimeout(resolve, 650));
    fs.writeFileSync(files.getPlanFilePath(root, task.key), '- [x] (p1) From IDE');
    await until(() => getLatestPlan(task.id)!.content.includes('[x]'));

    const source = analysis.createAnalysisSection({ task_id: task.id, title: 'API', description: 'Source' });
    const worked = analysis.createAnalysisSection({ task_id: task.id, title: 'API', kind: 'worked', author: 'agent', description: 'Worked' });
    assert.equal(worked.slug, 'api-2');
    const first = analysis.addAnalysisFile(source.id, { name: 'payload.json', mime: 'application/json', content: Buffer.from('{}') });
    const second = analysis.addAnalysisFile(source.id, { name: 'payload.json', content: Buffer.from('second') });
    assert.equal(second.name, 'payload-2.json');
    assert.equal(analysis.addAnalysisFile(source.id, { name: 'README.md', content: Buffer.from('attachment') }).name, 'README-2.md');
    assert.throws(() => analysis.addAnalysisFile(source.id, { name: '../bad', content: Buffer.alloc(1) }));
    assert.throws(() => analysis.addAnalysisFile(source.id, { name: 'big', content: Buffer.alloc(analysis.MAX_ANALYSIS_FILE_SIZE + 1) }), /25/);
    const analysisDir = files.getAnalysisDirectory(root, task.key);
    const readme = path.join(analysisDir, source.slug, 'README.md');
    assert.equal(fs.readFileSync(path.join(analysisDir, source.slug, first.name), 'utf8'), '{}');
    assert.match(fs.readFileSync(path.join(analysisDir, 'README.md'), 'utf8'), /Исходные[\s\S]*Проработанные/);
    fs.writeFileSync(readme, 'Edited on disk');
    fs.writeFileSync(path.join(analysisDir, worked.slug, 'README.md'), 'Also edited');
    await until(() => analysis.getAnalysisSection(source.id)!.description === 'Edited on disk'
      && analysis.getAnalysisSection(worked.id)!.description === 'Also edited');
    analysis.updateAnalysisSection(source.id, { title: 'Renamed', kind: 'worked' });
    assert.equal(analysis.getAnalysisSection(source.id)!.slug, 'api');
    analysis.reorderAnalysisSections(task.id, [worked.id, source.id, analysis.listAnalysisSections(task.id).find(s => s.id !== source.id && s.id !== worked.id)!.id]);
    assert.equal(analysis.listAnalysisSections(task.id)[0].id, worked.id);

    const queue = getQueue(task.id, project.id);
    queue.status = 'running';
    queue.stages = [{ id: 'stage', pauseAfter: false, sessions: [
      { id: 'active', points: ['p1'], agentId: 'agent-codex', queueMode: 'execute', permissionPolicy: 'ask', status: 'running' },
      { id: 'waiting', points: [], agentId: 'agent-codex', queueMode: 'execute', permissionPolicy: 'ask', status: 'waiting_for_developer' },
    ] }];
    saveQueue(queue, false);
    for (const write of [
      () => analysis.updateAnalysisSection(source.id, { description: 'blocked' }),
      () => analysis.createAnalysisSection({ task_id: task.id, title: 'Blocked' }),
      () => analysis.addAnalysisFile(source.id, { name: 'blocked', content: Buffer.alloc(1) }),
      () => analysis.deleteAnalysisFile(first.id),
      () => analysis.deleteAnalysisSection(source.id),
      () => analysis.reorderAnalysisSections(task.id, []),
    ]) assert.throws(write, /очередь/);
    fs.writeFileSync(readme, 'Forbidden disk edit');
    await until(() => fs.readFileSync(readme, 'utf8') === 'Edited on disk');
    assert.equal(analysis.getAnalysisSection(source.id)!.description, 'Edited on disk');
    queue.stages[0].sessions[0].status = 'waiting_for_developer';
    saveQueue(queue, false);
    analysis.updateAnalysisSection(source.id, { description: 'All wait' });
    queue.stages[0].sessions[0].status = 'complete';
    queue.stages[0].sessions[1].status = 'failed';
    saveQueue(queue, false);
    analysis.updateAnalysisSection(source.id, { description: 'All finished' });
    queue.stages[0].sessions[0].status = 'running';
    const session = createSession({ project_id: project.id, task_id: task.id, agent_id: 'agent-codex', role: 'executor', policy: 'ask' });
    updateSession(session.id, { status: 'waiting' });
    queue.stages[0].sessions[0].sessionId = session.id;
    saveQueue(queue, false);
    analysis.updateAnalysisSection(source.id, { description: 'Permission wait' });
    queue.status = 'paused';
    saveQueue(queue, false);
    analysis.updateAnalysisSection(source.id, { description: 'Paused' });
    fs.writeFileSync(readme, 'Offline edit');
    initTaskFiles();
    assert.equal(analysis.getAnalysisSection(source.id)!.description, 'Offline edit');
    analysis.deleteAnalysisFile(second.id);
    assert.equal(fs.existsSync(path.join(analysisDir, source.slug, second.name)), false);
    analysis.deleteAnalysisSection(worked.id);
    assert.equal(fs.existsSync(path.join(analysisDir, worked.slug)), false);
    assert.doesNotMatch(fs.readFileSync(path.join(analysisDir, 'README.md'), 'utf8'), /api-2/);

    updateTask(task.id, { status: 'done' });
    plans.deletePlanFile(getTask(task.id)!, root);
    assert.equal(fs.existsSync(files.getTaskDirectory(root, task.key)), false);
    assert.equal(analysis.getAnalysisFile(first.id)!.content.toString(), '{}');
    assert.throws(() => analysis.updateAnalysisSection(source.id, { description: 'Closed' }), /чтения/);
    updateTask(task.id, { status: 'open' });
    analysis.materializeTaskAnalysis(task.id);
    assert.equal(fs.existsSync(readme), true);
    assert.equal(analysis.listAnalysisSections(task.id).length, 2);
    deleteTask(task.id);
    assert.equal(analysis.getAnalysisSection(source.id), null);
    assert.equal(analysis.getAnalysisFile(first.id), null);
    assert.equal(fs.existsSync(files.getTaskDirectory(root, task.key)), false);
    assert.throws(() => files.getTaskDirectory(root, '../escape'));
    // Exercise the actual startup DB migration in fresh processes.
    const legacy = createTask({ project_id: project.id, key: 'LEGACY' });
    getDb().prepare('UPDATE tasks SET description=?, description_migrated=0 WHERE id=?').run('Legacy migration', legacy.id);
    const restart = () => {
      const child = spawnSync(process.execPath, ['-r', 'tsx/cjs', '-e',
        "const db=require('./server/infrastructure/db/schema').getDb();db.close();"], {
        cwd: process.cwd(), env: { ...process.env, PLANGENT_DATA_DIR: root }, encoding: 'utf8',
      });
      assert.equal(child.status, 0, child.stderr);
    };
    restart();
    const migrated = analysis.listAnalysisSections(legacy.id);
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0].title, 'Описание задачи');
    assert.equal(migrated[0].description, 'Legacy migration');
    assert.equal(getTask(legacy.id)!.description, null);
    analysis.deleteAnalysisSection(migrated[0].id);
    restart();
    assert.equal(analysis.listAnalysisSections(legacy.id).length, 0);
    deleteTask(legacy.id);
    // Existing destination wins during old-plan migration.
    const another = createTask({ project_id: project.id, key: 'KEEP' });
    fs.mkdirSync(files.getTaskDirectory(root, another.key), { recursive: true });
    fs.writeFileSync(files.getPlanFilePath(root, another.key), 'new');
    fs.writeFileSync(path.join(root, '.plangent', 'KEEP.plan.md'), 'old');
    files.migratePlanFile(root, another.key);
    assert.equal(fs.readFileSync(files.getPlanFilePath(root, another.key), 'utf8'), 'new');
    deleteTask(another.id);
  } finally {
    plans.stopWatchPlanFile(task.key);
    files.stopWatchAnalysis(task.id);
    getDb().close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
