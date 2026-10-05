import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changedFiles, diffFile, isRepository, listFiles, oldFile, parseStatus, repositoryInfo, snapshot, trackedStats } from './git';
import { resolveProjectPath } from '../projects/files';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
}
async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-git-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, 'init');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  return root;
}

test('local service: Cyrillic, CRLF, ignored files, staged/unstaged changes, rename and isolated snapshot', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'текст файл.txt'), 'one\ntwo\n');
  await fs.writeFile(path.join(root, 'rename.txt'), 'rename content\n');
  await fs.writeFile(path.join(root, 'deleted.txt'), 'delete me\n');
  await fs.writeFile(path.join(root, 'tracked.txt'), 'tracked\n');
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\n');
  git(root, 'add', '-A'); git(root, 'commit', '-m', 'Initial message');
  const initial = (await repositoryInfo(root))!;
  assert.ok(initial.branch); assert.equal(initial.detached, false); assert.equal(initial.message, 'Initial message');
  await fs.writeFile(path.join(root, 'текст файл.txt'), 'one\r\ntwo\r\n');
  assert.match(await diffFile(root, 'текст файл.txt'), /diff --git/);
  assert.equal(await diffFile(root, 'текст файл.txt', { ignoreWhitespace: true }), '');
  await fs.writeFile(path.join(root, 'текст файл.txt'), 'staged\n'); git(root, 'add', '--', 'текст файл.txt');
  await fs.writeFile(path.join(root, 'текст файл.txt'), 'working\n');
  git(root, 'mv', 'rename.txt', 'новое имя.txt');
  await fs.unlink(path.join(root, 'deleted.txt'));
  await fs.writeFile(path.join(root, 'новый файл.txt'), 'added\r\n');
  await fs.mkdir(path.join(root, 'ignored')); await fs.writeFile(path.join(root, 'ignored', 'secret.txt'), 'ignore');
  const files = await listFiles(root);
  assert.ok(files.includes('новый файл.txt')); assert.ok(!files.includes('ignored/secret.txt'));
  assert.ok((await listFiles(root, true)).includes('ignored/secret.txt'));
  assert.ok(!(await listFiles(root, true)).some(f => f.startsWith('.git/')));
  const changes = await changedFiles(root);
  assert.ok(changes.some(c => c.path === 'текст файл.txt' && c.indexStatus === 'M' && c.worktreeStatus === 'M'));
  assert.ok(changes.some(c => c.status === 'D' && c.path === 'deleted.txt'));
  assert.ok(changes.some(c => c.status === '?' && c.path === 'новый файл.txt'));
  assert.ok(changes.some(c => c.status === 'R' && c.originalPath === 'rename.txt' && c.path === 'новое имя.txt'));
  assert.equal(await oldFile(root, 'текст файл.txt'), 'one\ntwo\n');
  assert.match(await diffFile(root, 'новый файл.txt'), /\+added/);
  assert.match(await diffFile(root, 'новое имя.txt', { originalPath: 'rename.txt' }), /rename from rename.txt/);
  await fs.appendFile(path.join(root, '.gitignore'), 'tracked.txt\n');
  await fs.writeFile(path.join(root, 'tracked.txt'), 'tracked but ignored\n');
  const index = await fs.readFile(path.join(root, '.git', 'index'));
  const before = git(root, 'status', '--porcelain=v2', '-z');
  const tree = (await snapshot(root))!;
  assert.match(tree, /^[a-f0-9]{40,64}$/);
  assert.equal(await oldFile(root, 'tracked.txt', tree), 'tracked but ignored\n');
  assert.deepEqual(await fs.readFile(path.join(root, '.git', 'index')), index);
  assert.equal(git(root, 'status', '--porcelain=v2', '-z'), before);
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), initial.head);
  assert.equal(await oldFile(root, 'новый файл.txt', tree), 'added\r\n');
  assert.equal(await diffFile(root, 'текст файл.txt', { base: tree }), '');
  await fs.writeFile(path.join(root, 'текст файл.txt'), 'after snapshot\n');
  assert.match(await diffFile(root, 'текст файл.txt', { base: tree }), /\+after snapshot/);
  assert.match(await diffFile(root, 'текст файл.txt', { base: initial.head!, end: tree }), /\+working/);
  git(root, 'checkout', '--detach', initial.head!);
  assert.equal((await repositoryInfo(root))!.detached, true);
});

test('empty repositories and non-git projects degrade without using parent repository', async t => {
  const root = await fixture(t);
  assert.equal((await repositoryInfo(root))!.head, null);
  await fs.writeFile(path.join(root, 'first.txt'), 'first');
  const tree = (await snapshot(root))!;
  assert.equal(await oldFile(root, 'first.txt', tree), 'first');
  assert.equal(git(root, 'status', '--porcelain'), '?? first.txt\n');
  // Before the first commit HEAD is the empty tree: untracked and staged files diff as added.
  assert.match(await diffFile(root, 'first.txt'), /^\+first$/m);
  await fs.writeFile(path.join(root, 'staged.txt'), 'staged\n'); git(root, 'add', 'staged.txt');
  assert.match(await diffFile(root, 'staged.txt'), /^\+staged$/m);
  assert.deepEqual(await trackedStats(root), { 'staged.txt': { added: 1, deleted: 0 } });
  await assert.rejects(diffFile(root, 'first.txt', { base: 'main' }));
  const nested = path.join(root, 'nested'); await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'plain.txt'), 'plain');
  assert.equal(await isRepository(nested), false);
  assert.equal(await repositoryInfo(nested), null);
  assert.equal(await snapshot(nested), null);
  assert.deepEqual(await changedFiles(nested), []);
  assert.deepEqual(await listFiles(nested), ['plain.txt']);
});

test('paths and revision arguments cannot escape the project or become options', async t => {
  const root = await fixture(t);
  assert.throws(() => resolveProjectPath(root, '../outside'), /outside/);
  assert.throws(() => resolveProjectPath(root, '..\\outside'), /outside/);
  assert.throws(() => resolveProjectPath(root, 'bad\0path'), /Invalid/);
  await assert.rejects(oldFile(root, '.git/config'), /Invalid/);
  await assert.rejects(diffFile(root, 'file.txt', { base: '--output=outside' }), /Invalid/);
  await assert.rejects(diffFile(root, 'file.txt', { base: 'HEAD:outside' }), /Invalid/);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, 'escape'), 'junction');
  assert.throws(() => resolveProjectPath(root, 'escape/missing.txt'), /outside/);
  await assert.rejects(oldFile(root, 'escape/missing.txt'), /outside/);
});

test('porcelain parser keeps unusual paths and unmerged records intact', () => {
  const output = '1 .M N... 100644 100644 100644 abc def tabs\tand\nnewline.txt\0' +
    '2 R. N... 100644 100644 100644 abc def R100 new name\0old name\0' +
    'u UU N... 100644 100644 100644 100644 a b c conflict.txt\0';
  const changes = parseStatus(output);
  assert.equal(changes[0].path, 'tabs\tand\nnewline.txt');
  assert.equal(changes[1].originalPath, 'old name');
  assert.equal(changes[2].path, 'conflict.txt'); assert.equal(changes[2].status, 'U');
});