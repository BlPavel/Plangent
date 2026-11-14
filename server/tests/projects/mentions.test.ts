import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import express from 'express';

test('mentions resolve fuzzy and exact paths in the selected workspace and keep references', async t => {
  const { getDb } = await import('../../infrastructure/db/schema');
  const { projectsRouter } = await import('../../core-services').then(() => import('../../api/http/routes/projects'));
  const root = process.env.PLANGENT_DATA_DIR!;
  const main = path.join(root, 'main'), work = path.join(root, 'work'), reference = path.join(root, 'reference');
  for (const dir of [main, work, reference]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(main, 'same.ts'), 'main');
  fs.writeFileSync(path.join(work, 'same.ts'), 'work');
  fs.mkdirSync(path.join(work, 'nested'));
  fs.writeFileSync(path.join(work, 'nested', 'branch-only.ts'), 'branch');
  fs.writeFileSync(path.join(reference, 'guide.md'), 'guide');
  const db = getDb();
  const project = db.prepare('INSERT INTO projects(id,name,repo_path,kind,key) VALUES (?,?,?,?,?)');
  project.run('p', 'Main', main, 'project', 'main');
  project.run('other', 'Other', main, 'project', 'other');
  project.run('ref', 'Guide', reference, 'source', 'guide');
  db.exec("INSERT INTO tasks(id,project_id,key) VALUES ('t','p','T'),('ot','other','OT')");
  const workspace = db.prepare("INSERT INTO workspaces(id,project_id,task_id,branch,base_branch,path,status) VALUES (?,?,?,'feature','main',?,'ready')");
  workspace.run('w', 'p', 't', work);
  workspace.run('ow', 'other', 'ot', work);
  // A global viewing selection must not affect a project chat with no workspace.
  db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?)').run('workspace:viewing:p', 'w');
  const app = express(); app.use('/api/projects', projectsRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects/p/mentions?`;
  async function request(query: Record<string, string>) {
    const response = await fetch(base + new URLSearchParams(query));
    return { status: response.status, body: await response.json() as { path: string; dir: boolean; uri: string }[] };
  }
  assert.equal((await request({ q: 'same', workspace: 'w' })).body[0].uri, pathToFileURL(path.join(work, 'same.ts')).href);
  assert.equal((await request({ q: 'same' })).body[0].uri, pathToFileURL(path.join(main, 'same.ts')).href);
  assert.ok((await request({ q: 'branch-only', workspace: 'w' })).body.some(row => row.path === 'nested/branch-only.ts'));
  assert.equal((await request({ q: 'branch-only' })).body.length, 0);
  const exact = await request({ path: 'nested/branch-only.ts', workspace: 'w', q: 'ignored' });
  assert.deepEqual(exact.body, [{ path: 'nested/branch-only.ts', dir: false, uri: pathToFileURL(path.join(work, 'nested', 'branch-only.ts')).href }]);
  assert.equal((await request({ path: 'nested/', workspace: 'w' })).body[0].dir, true);
  assert.equal((await request({ path: 'nested/', workspace: 'w' })).body[0].path, 'nested/');
  assert.equal((await request({ path: '../main/same.ts', workspace: 'w' })).status, 400);
  assert.equal((await request({ path: 'missing', workspace: 'w' })).status, 404);
  assert.equal((await request({ q: 'same', workspace: 'ow' })).status, 404);
  assert.equal((await request({ q: 'same', workspace: 'missing' })).status, 404);
  assert.equal((await request({ q: 'guide/guide', workspace: 'w' })).body[0].uri, pathToFileURL(path.join(reference, 'guide.md')).href);
  db.exec("UPDATE workspaces SET status='preparing' WHERE id='w'");
  assert.equal((await request({ q: 'same', workspace: 'w' })).status, 409);
  assert.equal((await request({ path: 'same.ts', workspace: 'w' })).status, 409);
});
