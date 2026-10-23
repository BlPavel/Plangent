import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const data = fsSync.mkdtempSync(path.join(os.tmpdir(), 'plangent-branch-review-data-'));
process.env.PLANGENT_DATA_DIR = data;
function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
}

test('branch review: open, files changed after the last publication, new commits and force-push are reported', async t => {
  const { getDb } = await import('../../infrastructure/db/schema');
  const review = await import('./index');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-branch-review-repo-'));
  t.after(async () => { getDb().close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(data, { recursive: true, force: true }); });
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); await fs.writeFile(path.join(root, 'b.txt'), 'b\n');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'base');
  git(root, 'switch', '-c', 'feature');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\n'); await fs.writeFile(path.join(root, 'b.txt'), 'b\nchanged\n');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'Feature work');
  getDb().prepare("INSERT INTO projects (id,kind,name,key,repo_path) VALUES ('p1','project','P','p',?)").run(root);

  const listed = await review.listBranches('p1');
  assert.deepEqual(listed.branches.map(b => b.ref).sort(), ['refs/heads/feature', 'refs/heads/main']);
  assert.equal(listed.current, 'feature');
  assert.equal(listed.default_base, 'refs/heads/main');
  await assert.rejects(review.openReview('p1', { branch: 'refs/heads/feature', base: 'refs/heads/feature' }), /разные ветки/);
  await assert.rejects(review.openReview('p1', { branch: 'nope', base: 'refs/heads/main' }), /Ветка не найдена/);

  const opened = await review.openReview('p1', { branch: 'refs/heads/feature', base: 'refs/heads/main' });
  assert.deepEqual(opened.files.map(f => f.path), ['a.txt', 'b.txt']);
  assert.equal(opened.commit_count, 1);
  assert.equal((await review.openReview('p1', { branch: 'refs/heads/feature', base: 'refs/heads/main' })).review.id, opened.review.id);
  const id = opened.review.id;
  assert.match((await review.diff('p1', id, 'a.txt')).diff, /\+two/);
  assert.equal((await review.content('p1', id, 'a.txt')).content, 'one\ntwo\n');
  await assert.rejects(review.diff('p1', id, 'missing.txt'), /не найден/);
  await assert.rejects(review.detail('other', id), /Проект не найден/);

  // As if remarks were published at this head: the next round shows what the author changed after it.
  getDb().prepare('UPDATE branch_reviews SET published_head=? WHERE id=?').run(opened.review.head, id);
  await review.acknowledge('p1', id);
  await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\nthree\n');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'Follow-up');
  const updated = await review.detail('p1', id);
  assert.equal(updated.new_commits, 1);
  assert.equal(updated.rewritten, false);
  assert.equal(updated.round_commits, 1);
  assert.equal(updated.files.find(f => f.path === 'a.txt')?.changed_since, true);
  assert.equal(updated.files.find(f => f.path === 'b.txt')?.changed_since, false);
  assert.equal((await review.acknowledge('p1', id)).new_commits, 0);

  git(root, 'reset', '--hard', 'main');
  await fs.writeFile(path.join(root, 'c.txt'), 'rewritten\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'Rewritten');
  const rewritten = await review.detail('p1', id);
  assert.equal(rewritten.rewritten, true);
  assert.deepEqual(rewritten.files.map(f => f.path), ['c.txt']);
  await assert.rejects(review.openThread('p1', id, {}), /агента/);
});
