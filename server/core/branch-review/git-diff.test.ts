import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitOf, fileAt, fileDiff, isAncestor, mergeBase, parseRaw, rangeCommits, rangeCount, rangeFiles, resolveRef } from './git-diff';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
}
const write = (root: string, name: string, text: string) => fs.writeFile(path.join(root, name), text);

test('branch range: merge-base diff, signatures, commits and force-push detection', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-branch-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await write(root, 'a.txt', 'one\ntwo\n'); await write(root, 'old.txt', 'rename me\nsome stable content\n'); await write(root, 'gone.txt', 'bye\n');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'base');
  git(root, 'switch', '-c', 'feature');
  await write(root, 'a.txt', 'one\ntwo\nthree\n');
  git(root, 'mv', 'old.txt', 'new.txt'); git(root, 'rm', 'gone.txt');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'Change a');
  // The base moves on: the review must compare against the merge-base, not the base tip.
  git(root, 'switch', 'main');
  await write(root, 'base-only.txt', 'later\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'main moves');

  const head = await resolveRef(root, 'refs/heads/feature'), base = await resolveRef(root, 'refs/heads/main');
  const headSha = await commitOf(root, head.ref), baseSha = await commitOf(root, base.ref);
  const from = await mergeBase(root, baseSha, headSha);
  const files = await rangeFiles(root, from, headSha);
  assert.deepEqual(files.map(f => [f.path, f.status]), [['a.txt', 'M'], ['gone.txt', 'D'], ['new.txt', 'R']]);
  assert.equal(files.find(f => f.path === 'new.txt')?.old_path, 'old.txt');
  assert.ok(files.every(f => /^[0-9a-f]+:[0-9a-f]+$/.test(f.sig)));
  assert.match(await fileDiff(root, from, headSha, files[0]), /\+three/);
  assert.equal(await fileAt(root, headSha, 'a.txt'), 'one\ntwo\nthree\n');
  assert.deepEqual((await rangeCommits(root, from, headSha)).map(c => c.subject), ['Change a']);
  assert.equal(await rangeCount(root, from, headSha), 1);

  // A later commit changes the signature of the file; an unrelated file keeps it.
  const before = new Map(files.map(f => [f.path, f.sig]));
  git(root, 'switch', 'feature');
  await write(root, 'a.txt', 'one\ntwo\nthree\nfour\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'More');
  const next = await commitOf(root, 'feature');
  const after = new Map((await rangeFiles(root, from, next)).map(f => [f.path, f.sig]));
  assert.notEqual(after.get('a.txt'), before.get('a.txt'));
  assert.equal(after.get('new.txt'), before.get('new.txt'));
  assert.equal(await isAncestor(root, headSha, next), true);
  git(root, 'reset', '--hard', from);
  assert.equal(await isAncestor(root, next, await commitOf(root, 'feature')), false);
});

test('only existing branches can be reviewed and shas are validated', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-branch-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await write(root, 'a.txt', 'x\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'one');
  await assert.rejects(resolveRef(root, '--upload-pack=evil'), /Ветка не найдена/);
  await assert.rejects(resolveRef(root, 'refs/heads/missing'), /Ветка не найдена/);
  await assert.rejects(rangeFiles(root, 'main', 'HEAD'), /Invalid commit/);
  assert.equal((await resolveRef(root, 'refs/heads/main')).name, 'main');
});

test('raw diff parser keys renames by the new path', () => {
  const raw = ':100644 100644 aaa bbb M\0a.txt\0:100644 100644 ccc ddd R090\0old.txt\0new.txt\0';
  assert.deepEqual([...parseRaw(raw)], [['a.txt', 'aaa:bbb'], ['new.txt', 'ccc:ddd']]);
});
