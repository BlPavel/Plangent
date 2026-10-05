import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import express from 'express';
import { migrate } from '../../infrastructure/db/schema';
import { createReviewService } from './reviews';
import { createReviewStore } from './store';
import { createCodeReviewsRouter } from '../../infrastructure/http/routes/code-reviews';

test('review lifecycle, branch isolation, relocation, hashes and carry on a real repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-reviews-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.prepare("INSERT INTO projects(id,name,repo_path,kind) VALUES ('project','Review',?,'project')").run(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const service = createReviewService(db);
  const store = createReviewStore(db);
  const file = 'code.ts';
  const initial = 'first\nselected\nlast\n';
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await fs.writeFile(path.join(root, file), initial);
    git('add', '.'); git('commit', '-m', 'Initial');
    const start = git('rev-parse', 'HEAD');
    assert.equal((await service.current('project')).review, null);
    const drafts = await Promise.all([service.addDraft('project', { scope: 'line', file, line_start: 2,
      kind: 'fix', text: 'Fix selected', code_snippet: 'untrusted' }),
    service.addDraft('project', { scope: 'general', kind: 'question', text: 'Question?' })]);
    const review = drafts[0].review;
    const item = drafts[0].item;
    assert.equal(drafts[1].review.id, review.id);
    assert.equal(item.code_snippet, 'selected');
    assert.equal(review.head_start, start);
    await service.markViewed('project', review.id, file, true);
    assert.equal((await service.current('project')).file_views[0].viewed, true);
    await fs.writeFile(path.join(root, file), 'inserted\n' + initial);
    let relocated = (await service.openFile('project', review.id, file))[0];
    assert.equal(relocated.line_start, 3);
    assert.equal(relocated.outdated, false);
    assert.equal((await service.current('project')).file_views[0].changed_after_view, true);
    await fs.writeFile(path.join(root, file), initial);
    assert.equal((await createReviewService(db).current('project')).file_views[0].viewed, false, 'Reverting content and restarting the service does not restore viewed');
    await service.markViewed('project', review.id, file, true);
    await fs.writeFile(path.join(root, file), 'gone\n');
    relocated = (await service.openFile('project', review.id, file))[0];
    assert.equal(relocated.outdated, true);
    assert.equal(relocated.code_snippet, 'selected');
    await service.makeGeneral('project', review.id, item.id);
    assert.equal(store.getItem(item.id)!.scope, 'general');
    assert.equal(store.getItem(item.id)!.file, null);
    await assert.rejects(service.finish('project', review.id), /Unresolved/);
    git('add', '.'); git('commit', '-m', 'Developer change');
    const end = git('rev-parse', 'HEAD');
    const current = await service.current('project');
    assert.equal(current.review!.status, 'open', 'A commit never auto-closes a review');
    assert.equal(current.head_changed, true);
    assert.equal(current.summary!.commits, 1);
    assert.equal(current.review!.head_last, end);
    assert.match(await service.reviewDiff('project', review.id, file), /\+gone/);
    git('switch', '-c', 'feature');
    assert.equal((await service.current('project')).review, null);
    assert.equal((await service.detail('project', review.id)).read_only, true);
    assert.match(await service.reviewDiff('project', review.id, file), /\+gone/);
    await assert.rejects(service.updateDraft('project', review.id, item.id, { text: 'Wrong branch' }), /read-only/);
    await assert.rejects(service.finish('project', review.id, 'carry'), /read-only/);
    const feature = await service.addDraft('project', { scope: 'file', file, kind: 'fix', text: 'Feature' });
    git('switch', 'main');
    assert.equal((await service.current('project')).review!.id, review.id);
    const closed = await service.finish('project', review.id, 'carry');
    assert.equal(closed.review.head_end, end);
    assert.ok(closed.review.closed_at);
    assert.equal(closed.next_review!.branch, 'main');
    const carried = store.listItems(closed.next_review!.id);
    assert.equal(carried.length, 2);
    assert.ok(carried.every(row => row.status === 'draft' && row.round_id === null && row.answer === null));
    assert.ok(carried.some(row => row.carried_from_item_id === item.id && row.code_snippet === 'selected'));
    await assert.rejects(service.updateDraft('project', review.id, item.id, { text: 'History' }), /read-only/);
    git('branch', '-D', 'feature');
    assert.equal((await service.history('project')).find(row => row.id === feature.review.id)!.status, 'abandoned');
    await service.finish('project', feature.review.id, 'close');
    const history = await service.history('project');
    assert.equal(history.find(row => row.id === review.id)!.commits, 1);
    assert.equal(history.find(row => row.id === review.id)!.unresolved, 2);
    await service.finish('project', closed.next_review!.id, 'close');
    assert.ok(store.listItems(closed.next_review!.id).every(row => row.status === 'rejected'));
    git('switch', '--detach', start);
    const detached = await service.addDraft('project', { scope: 'file', file, kind: 'fix', text: 'Detached' });
    assert.equal(detached.review.branch, null);
    assert.equal(detached.review.head_commit, start);
    git('switch', '--detach', end);
    assert.equal((await service.current('project')).review, null);
    git('switch', '--detach', start);
    assert.equal((await service.current('project')).review!.id, detached.review.id);
    await service.removeReview('project', detached.review.id);
    assert.equal(store.getReview(detached.review.id), null);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('HTTP contract, no-Git projects, immutable history and chat cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-review-http-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.prepare("INSERT INTO projects(id,name,repo_path,kind) VALUES ('project','Review',?,'project')").run(root);
  db.prepare("INSERT INTO projects(id,name,repo_path,kind) VALUES ('other','Other',?,'project')").run(root);
  db.exec(`CREATE TABLE agent_sessions (id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE agent_session_events (session_id TEXT REFERENCES agent_sessions(id) ON DELETE CASCADE,
      seq INTEGER,type TEXT,payload TEXT,created_at TEXT);
    INSERT INTO agent_sessions VALUES ('session','thinking');
    INSERT INTO agent_session_events VALUES ('session',1,'assistant','{"text":"answer"}','now');`);
  const stopped: string[] = [];
  const service = createReviewService(db, { closeSession: async id => { stopped.push(id); } });
  const store = createReviewStore(db);
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/code-reviews', createCodeReviewsRouter(() => service));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/projects/project/code-reviews';
  const request = (url: string, method = 'GET', data?: unknown) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  try {
    await fs.writeFile(path.join(root, 'file.txt'), 'content\n');
    assert.equal((await request('/current')).status, 200);
    for (const data of [{ scope: 'line', file: 'file.txt', line_start: 1, kind: 'fix', text: 'No Git' },
      { scope: 'file', file: '../escape', kind: 'fix', text: 'Invalid' },
      { scope: 'general', kind: 'bad', text: 'Invalid' }])
      assert.equal((await request('/items', 'POST', data)).status, 400);
    assert.equal(store.listReviews('project').length, 0, 'Invalid first drafts leave no empty review');
    const created = await request('/items', 'POST', { scope: 'file', file: 'file.txt', kind: 'fix', text: 'Remark' });
    assert.equal(created.status, 201);
    const { review, item } = await created.json() as Awaited<ReturnType<typeof service.addDraft>>;
    assert.equal((await service.current('project')).review!.id, review.id);
    assert.equal((await request('/' + review.id + '/viewed', 'PUT', { path: 'file.txt', viewed: true })).status, 400);
    assert.equal((await request('/' + review.id + '/items/' + item.id, 'PATCH', { text: 'Edited' })).status, 200);
    assert.equal((await request('/' + review.id + '/items/' + item.id, 'PATCH', { status: 'done' })).status, 400);
    assert.equal((await fetch(base.replace('/project/', '/other/') + '/' + review.id)).status, 404);
    assert.equal((await fetch(base + '/current', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
    const round = store.createRound({ review_id: review.id, snapshot_tree: '', session_id: 'session' });
    store.updateItem(item.id, { round_id: round.id, status: 'sent' });
    assert.equal((await request('/' + review.id + '/finish', 'POST', { mode: 'close' })).status, 409);
    const draft = await service.addDraft('project', { scope: 'general', kind: 'question', text: 'During agent work' });
    assert.equal(draft.review.id, review.id);
    const pausedService = createReviewService(db, {
      repository: async () => ({ branch: 'other-branch', head: 'other-head', message: '', detached: false }),
      branches: async () => ['other-branch'],
    });
    assert.equal((await pausedService.current('project')).running_other_reviews[0].id, review.id);
    await assert.rejects(service.finish('project', review.id, 'carry'), /Agent is working/);
    db.prepare("UPDATE agent_sessions SET status='ready'").run();
    assert.equal((await service.detail('project', review.id)).chats[0].events.length, 1);
    assert.equal((await request('/' + review.id + '/finish', 'POST', { mode: 'carry' })).status, 200);
    assert.equal((await service.detail('project', review.id)).read_only, true);
    const next = (await service.current('project')).review!;
    assert.equal(store.listItems(next.id).length, 2);
    assert.equal((await service.openFile('project', review.id, 'file.txt')).length, 1);
    const fresh = await service.addDraft('project', { scope: 'general', kind: 'fix', text: 'Delete me' });
    await service.removeItem('project', next.id, fresh.item.id);
    assert.equal(store.getItem(fresh.item.id), null);
    assert.equal((await request('/' + review.id + '/items/' + item.id, 'DELETE')).status, 409);
    assert.equal((await request('/' + review.id, 'DELETE')).status, 204);
    assert.deepEqual(stopped, ['session']);
    assert.equal(db.prepare('SELECT 1 FROM agent_sessions').get(), undefined);
    assert.equal(db.prepare('SELECT 1 FROM agent_session_events').get(), undefined);
    assert.equal(store.listRounds(review.id).length, 0);
    assert.equal(store.listItems(review.id).length, 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('p7 migration upgrades existing review data without losing hashes, anchors or history', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    migrate(db);
    db.exec("INSERT INTO projects(id,name,repo_path) VALUES ('project','Existing','/existing')");
    const store = createReviewStore(db);
    const review = store.createReview({ project_id: 'project', branch: 'main', head_start: 'start',
      origin: 'project', origin_id: 'project' });
    const item = store.createItem({ review_id: review.id, scope: 'line', file: 'code.ts', line_start: 3,
      kind: 'fix', text: 'Keep me', code_snippet: 'selected' });
    store.markFileViewed(review.id, 'code.ts', 'original-hash');
    // Simulate the p6 schema, before lifecycle fields were added.
    db.exec('ALTER TABLE code_review DROP COLUMN head_last; ALTER TABLE code_review_file_view DROP COLUMN invalidated;');
    migrate(db);
    migrate(db);
    assert.equal(store.getReview(review.id)!.head_last, 'start');
    assert.equal(store.getItem(item.id)!.code_snippet, 'selected');
    assert.equal(store.listFileViews(review.id)[0].content_hash, 'original-hash');
    assert.equal(store.listFileViews(review.id)[0].invalidated, false);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});

test('viewed before any remark opens the review; deleted files are viewable; comparison bases list their files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-bases-'));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.prepare("INSERT INTO projects(id,name,repo_path,kind) VALUES ('project','Bases',?,'project')").run(root);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const service = createReviewService(db);
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    await fs.writeFile(path.join(root, 'gone.txt'), 'gone\n');
    git('add', '.'); git('commit', '-m', 'Initial');
    const start = git('rev-parse', 'HEAD');
    assert.equal((await service.current('project')).review, null);
    await assert.rejects(service.markViewedCurrent('project', 'missing.txt', true), /not found/i);
    assert.equal((await service.current('project')).review, null, 'a failed mark must not leave an empty review');
    assert.equal((await service.markViewedCurrent('project', 'a.txt', false)).review, null);

    await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    const first = await service.markViewedCurrent('project', 'a.txt', true);
    assert.equal(first.view!.path, 'a.txt');
    await fs.unlink(path.join(root, 'gone.txt'));
    const second = await service.markViewedCurrent('project', 'gone.txt', true);
    assert.equal(second.review!.id, first.review!.id, 'one review per branch');
    let views = (await service.current('project')).file_views;
    assert.deepEqual(views.map(view => [view.path, view.viewed]).sort(), [['a.txt', true], ['gone.txt', true]]);
    await fs.writeFile(path.join(root, 'gone.txt'), 'back\n');
    views = (await service.current('project')).file_views;
    assert.equal(views.find(view => view.path === 'gone.txt')!.changed_after_view, true);
    await service.markViewedCurrent('project', 'a.txt', false);
    assert.deepEqual((await service.current('project')).file_views.map(view => view.path), ['gone.txt']);

    // Everything that entered the review: head_start → HEAD, renames detected.
    git('mv', 'a.txt', 'b.txt'); await fs.writeFile(path.join(root, 'b.txt'), 'one\ntwo\nthree\nfour\nfive\nmore\n');
    git('add', '.'); git('commit', '-m', 'Developer');
    const head = git('rev-parse', 'HEAD');
    const entered = await service.baseChanges('project', first.review!.id, 'review');
    assert.equal(entered.base, start); assert.equal(entered.end, head);
    assert.deepEqual(entered.changes.map(change => [change.status, change.path, change.originalPath]).sort(),
      [['M', 'gone.txt', undefined], ['R', 'b.txt', 'a.txt']].sort());
    assert.ok(entered.stats['b.txt'].added >= 1);
    await assert.rejects(service.baseChanges('project', first.review!.id, 'agent'), /Round not found/);
    await assert.rejects(service.baseChanges('project', first.review!.id, 'other' as 'agent'), /Invalid base/);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
