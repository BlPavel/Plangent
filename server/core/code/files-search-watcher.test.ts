import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileTree, readCodeFile, readBytes, changeStats, MAX_FILE_SIZE } from './files';
import { searchCode, type SearchEvent } from './search';
import { relevantChange, subscribeCode } from './watcher';

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
}
async function fixture(t: { after(fn: () => Promise<void>): void }, repository = true): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-code-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (repository) {
    git(root, 'init'); git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.invalid');
  }
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'test.ts'), 'one\r\nNeedle needlework NEEDLE\r\nvalue42\r\n');
  await fs.writeFile(path.join(root, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored/\n');
  if (repository) { git(root, 'add', '-A'); git(root, 'commit', '-m', 'Initial'); }
  await fs.mkdir(path.join(root, 'ignored'));
  await fs.writeFile(path.join(root, 'ignored', 'hidden.txt'), 'Needle');
  await fs.writeFile(path.join(root, 'untracked.txt'), 'Needle\nsecond Needle\n');
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([78, 101, 101, 100, 108, 101, 0]));
  await fs.writeFile(path.join(root, 'large.txt'), 'Needle\n' + 'x'.repeat(MAX_FILE_SIZE));
  return root;
}
async function collect(root: string, options: Parameters<typeof searchCode>[1]): Promise<SearchEvent[]> {
  const events: SearchEvent[] = [];
  for await (const event of searchCode(root, options)) events.push(event);
  return events;
}

test('tree levels, ignored toggle, statuses, text/image/binary/large and containment', async t => {
  const root = await fixture(t);
  await fs.appendFile(path.join(root, 'src', 'test.ts'), 'changed\n');
  const tree = await fileTree(root);
  assert.equal(tree.find(e => e.path === 'src')!.changes, 1);
  assert.ok(!tree.some(e => e.path.startsWith('src/')));
  assert.ok(!tree.some(e => e.path === 'ignored' || e.path === '.git'));
  assert.equal((await fileTree(root, '', true)).find(e => e.path === 'ignored')!.ignored, true);
  assert.equal((await fileTree(root, 'src'))[0].status, 'M');
  assert.equal((await readCodeFile(root, 'src/test.ts')).content, 'one\r\nNeedle needlework NEEDLE\r\nvalue42\r\nchanged\n');
  assert.equal((await readCodeFile(root, 'image.svg')).kind, 'image');
  assert.equal((await readCodeFile(root, 'binary.bin')).kind, 'binary');
  assert.equal((await readCodeFile(root, 'large.txt')).kind, 'too-large');
  assert.ok((await readBytes(root, 'image.svg')).bytes);
  await assert.rejects(readCodeFile(root, '../outside'), /Invalid/);
  await assert.rejects(readCodeFile(root, '.git/config'), /Invalid/);
  await assert.rejects(readCodeFile(root, 'missing.txt'), /not found/);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-code-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, 'escape'), 'junction');
  await assert.rejects(readCodeFile(root, 'escape/secret'), /Invalid/);
  assert.ok(!(await fileTree(root, '', true)).some(e => e.path === 'escape'));
});

test('Git search includes untracked, excludes ignored/binary/large, handles CRLF, masks and options', async t => {
  const root = await fixture(t);
  const events = await collect(root, { query: 'needle' });
  assert.deepEqual(events.at(-1), { type: 'done', matches: 3, files: 2, truncated: false });
  const match = events.find(e => e.type === 'match' && e.path === 'src/test.ts');
  assert.deepEqual(match, { type: 'match', path: 'src/test.ts', line: 2, text: 'Needle needlework NEEDLE' });
  assert.equal((await collect(root, { query: 'needle', caseSensitive: true, wholeWord: true })).length, 1);
  assert.equal((await collect(root, { query: 'Needle', mask: '*.ts' })).length, 2);
  assert.equal((await collect(root, { query: 'value[0-9]+', regex: true, mask: 'src/**' })).length, 2);
  assert.equal((await collect(root, { query: 'needle', mask: '**/*.ts' })).length, 2);
  assert.equal((await collect(root, { query: 'value\\d+', regex: true })).length, 2);
  await fs.writeFile(path.join(root, 'space name.txt'), 'Needle\n');
  assert.ok((await collect(root, { query: 'Needle', mask: 'space*' })).some(e => e.type === 'match' && e.path === 'space name.txt'));
  await assert.rejects(collect(root, { query: '[', regex: true }), /Invalid regular/);
  await assert.rejects(collect(root, { query: '' }), /query/);
});

test('Node fallback searches without git and bounds matches and files', async t => {
  const root = await fixture(t, false);
  assert.equal((await collect(root, { query: 'Needle', mask: 'src/**', wholeWord: true })).length, 2);
  await fs.writeFile(path.join(root, 'many.txt'), 'Needle\n'.repeat(2001));
  assert.deepEqual((await collect(root, { query: 'Needle', mask: 'many.txt' })).at(-1),
    { type: 'done', matches: 2000, files: 1, truncated: true });
  for (let n = 0; n < 201; n++) await fs.writeFile(path.join(root, 'f' + n + '.txt'), 'limit');
  assert.deepEqual((await collect(root, { query: 'limit', mask: 'f*.txt' })).at(-1),
    { type: 'done', matches: 200, files: 200, truncated: true });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collect(root, { query: 'Needle', signal: controller.signal }), { name: 'AbortError' });
});

test('Git streaming limits and cancellation while consuming results', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'many.txt'), 'Needle\n'.repeat(2001));
  assert.deepEqual((await collect(root, { query: 'Needle', mask: 'many.txt' })).at(-1),
    { type: 'done', matches: 2000, files: 1, truncated: true });
  const controller = new AbortController();
  const iterator = searchCode(root, { query: 'Needle', mask: 'many.txt', signal: controller.signal });
  assert.equal((await iterator.next()).value?.type, 'match');
  controller.abort();
  await assert.rejects(iterator.next(), { name: 'AbortError' });
});

test('watcher debounces, shares root, handles HEAD and releases last subscription', async t => {
  const root = await fixture(t);
  assert.ok(!relevantChange('node_modules/a.js'));
  assert.ok(!relevantChange('.git/objects/ab/cd'));
  assert.ok(relevantChange('.git/HEAD'));
  assert.ok(relevantChange('.git/refs/heads/main'));
  let count = 0, secondCount = 0;
  const stop = subscribeCode(root, 'one', () => count++);
  const second = subscribeCode(root, 'two', () => secondCount++);
  t.after(async () => { stop(); second(); });
  const changedFile = process.platform === 'linux' ? path.join(root, '.git', 'HEAD') : path.join(root, 'src', 'test.ts');
  const original = await fs.readFile(changedFile);
  await fs.writeFile(changedFile, original);
  await fs.writeFile(changedFile, original);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(count, 1); assert.equal(secondCount, 1);
  stop();
  await fs.writeFile(changedFile, original);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(count, 1); assert.equal(secondCount, 2);
  second(); second();
  await fs.writeFile(changedFile, original);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(secondCount, 2);
});

test('change stats count tracked edits, renames and untracked files', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'src', 'test.ts'), 'one\ntwo\nthree\n');
  git(root, 'mv', 'image.svg', 'moved.svg');
  const stats = await changeStats(root);
  assert.deepEqual(stats['src/test.ts'], { added: 3, deleted: 3 });
  assert.deepEqual(stats['moved.svg'], { added: 0, deleted: 0 });
  assert.deepEqual(stats['untracked.txt'], { added: 2, deleted: 0 });
  assert.equal(stats['binary.bin'].binary, true);
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-code-nogit-'));
  t.after(() => fs.rm(empty, { recursive: true, force: true }));
  assert.deepEqual(await changeStats(empty), {});
});
