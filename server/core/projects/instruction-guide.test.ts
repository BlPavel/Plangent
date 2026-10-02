import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';

test('instruction guides resolve the closest enabled level and expose defaults', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-instruction-guide-'));
  const previousCwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('./index');
  const library = await import('../library');
  const files = await import('../library/library-manager');
  const { DEFAULT_INSTRUCTION_GUIDE, resolveInstructionGuide } = await import('../library/instruction-guide');
  const { syncItem, unsyncItem } = await import('../library/syncer');
  const { libraryRouter } = await import('../../infrastructure/http/routes/library');
  const app = express();
  app.use(express.json());
  app.use('/library', libraryRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/library';
  try {
    const group = createProject({ kind: 'group', name: 'Group' });
    const project = createProject({ name: 'Project', repo_path: path.join(root, 'project'), group_id: group.id });
    const solo = createProject({ name: 'Solo', repo_path: path.join(root, 'solo') });
    assert.ok(DEFAULT_INSTRUCTION_GUIDE.trim());
    assert.equal(resolveInstructionGuide(project.id), DEFAULT_INSTRUCTION_GUIDE);
    assert.equal(resolveInstructionGuide('missing-project'), DEFAULT_INSTRUCTION_GUIDE);
    const defaults = await fetch(base + '/instruction-guide/defaults');
    assert.equal(defaults.status, 200);
    assert.deepEqual(await defaults.json(), { content: DEFAULT_INSTRUCTION_GUIDE });

    const global = library.createLibraryItem({ type: 'instruction-guide', slug: 'global-guide', title: 'Global', scope: 'global' });
    files.writeItemContent(global, 'GLOBAL');
    assert.equal(resolveInstructionGuide(project.id), 'GLOBAL');
    assert.equal(resolveInstructionGuide('missing-project'), 'GLOBAL');
    const shared = library.createLibraryItem({ type: 'instruction-guide', slug: 'group-guide', title: 'Group', scope: 'project', targets: [group.id] });
    files.writeItemContent(shared, 'GROUP');
    assert.equal(resolveInstructionGuide(project.id), 'GROUP');
    assert.equal(resolveInstructionGuide(group.id), 'GROUP');
    assert.equal(resolveInstructionGuide(solo.id), 'GLOBAL');
    const own = library.createLibraryItem({ type: 'instruction-guide', slug: 'project-guide', title: 'Project', scope: 'project', targets: [project.id] });
    files.writeItemContent(own, 'PROJECT');
    assert.equal(resolveInstructionGuide(project.id), 'PROJECT');
    assert.ok(fs.existsSync(path.join(root, 'data', 'library', 'instruction-guides', own.slug, 'INSTRUCTION_GUIDE.md')));
    syncItem(own);
    unsyncItem(own);
    assert.equal(files.readItemContent(own), 'PROJECT');
    const duplicate = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'instruction-guide', slug: 'duplicate', title: 'Duplicate', scope: 'project', targets: [project.id] }) });
    assert.equal(duplicate.status, 409);

    library.updateLibraryItem(own.id, { enabled: false });
    assert.equal(resolveInstructionGuide(project.id), 'GROUP');
    library.updateLibraryItem(shared.id, { own_only: [group.id] });
    assert.equal(resolveInstructionGuide(project.id), 'GLOBAL');
    library.updateLibraryItem(shared.id, { own_only: [] });
    library.setExcluded(shared.id, project.id, true);
    assert.equal(resolveInstructionGuide(project.id), 'GLOBAL');
    library.setExcluded(shared.id, project.id, false);
    library.updateLibraryItem(shared.id, { enabled: false });
    assert.equal(resolveInstructionGuide(project.id), 'GLOBAL');
    library.updateLibraryItem(global.id, { enabled: false });
    assert.equal(resolveInstructionGuide(project.id), DEFAULT_INSTRUCTION_GUIDE);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    getDb().close();
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
