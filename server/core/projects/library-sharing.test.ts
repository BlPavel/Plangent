import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import type { LibraryItem, LibraryItemType } from '../../models';

test('editing shared instructions isolates project content', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-library-sharing-'));
  const previousCwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('./index');
  const library = await import('../library');
  const files = await import('../library/library-manager');
  const { libraryRouter } = await import('../../infrastructure/http/routes/library');
  const group = createProject({ kind: 'group', name: 'Group' });
  const project = createProject({ name: 'Project', repo_path: path.join(root, 'project'), group_id: group.id });
  const sibling = createProject({ name: 'Sibling', repo_path: path.join(root, 'sibling'), group_id: group.id });
  const app = express();
  app.use(express.json());
  app.use('/library', libraryRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/library`;
  const request = (url: string, method: string, body: unknown) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    for (const type of ['main', 'skill', 'command', 'plan-template'] as LibraryItemType[]) {
      for (const direct of [false, true]) {
        const item = library.createLibraryItem({
          type, slug: `${type}-${direct}`, title: 'Shared', scope: 'project',
          targets: direct ? [group.id, project.id] : [group.id],
        });
        files.writeItemContent(item, 'GROUP');
        assert.ok(library.libraryItemsFor(project).some(i => i.id === item.id));
        const response = await request(`/${item.id}/detach`, 'POST', { projectId: project.id });
        assert.equal(response.status, 201);
        const copy = await response.json() as LibraryItem;
        assert.equal(copy.detached_from, item.id);
        assert.deepEqual(copy.targets, [project.id]);
        assert.equal(files.readItemContent(copy), 'GROUP');
        assert.equal((await request(`/${copy.id}`, 'PUT', { content: 'PROJECT' })).status, 200);
        assert.equal(files.readItemContent(item), 'GROUP');
        assert.equal(files.readItemContent(copy), 'PROJECT');
        assert.deepEqual(library.getLibraryItem(item.id)!.targets, [group.id]);
        assert.ok(library.getLibraryItem(item.id)!.excluded.includes(project.id));
        assert.ok(!library.libraryItemsFor(project).some(i => i.id === item.id));
        assert.ok(library.libraryItemsFor(project).some(i => i.id === copy.id));
        assert.ok(library.libraryItemsFor(group).some(i => i.id === item.id));
        assert.ok(library.libraryItemsFor(sibling).some(i => i.id === item.id));
        // Main content and agent overrides must also live separately from the shared files.
        files.writeOverrideContent(item, 'test-agent', 'GROUP OVERRIDE');
        files.writeOverrideContent(copy, 'test-agent', 'PROJECT OVERRIDE');
        assert.equal(files.readOverrideContent(item, 'test-agent'), 'GROUP OVERRIDE');
        assert.equal(files.readOverrideContent(copy, 'test-agent'), 'PROJECT OVERRIDE');
        assert.equal((await request(`/${copy.id}`, 'DELETE', {})).status, 200);
        assert.equal(library.getLibraryItem(copy.id), null);
        assert.equal(files.readItemContent(item), 'GROUP');
        assert.ok(!library.libraryItemsFor(project).some(i => i.id === item.id));
        library.setExcluded(item.id, project.id, false);
        // Exclusion works even if the project has an explicit target as well as its group.
        library.updateLibraryItem(item.id, { targets: [group.id, project.id] });
        assert.equal((await request(`/${item.id}/exclude`, 'POST', { projectId: project.id })).status, 200);
        assert.deepEqual(library.getLibraryItem(item.id)!.targets, [group.id]);
        assert.ok(!library.libraryItemsFor(project).some(i => i.id === item.id));
        assert.ok(library.libraryItemsFor(sibling).some(i => i.id === item.id));
      }
    }
    const own = library.createLibraryItem({ type: 'skill', slug: 'own', title: 'Own', scope: 'project', targets: [project.id] });
    assert.equal((await request(`/${own.id}/detach`, 'POST', { projectId: project.id })).status, 400);
    assert.deepEqual(library.getLibraryItem(own.id)!.targets, [project.id]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    getDb().close();
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});