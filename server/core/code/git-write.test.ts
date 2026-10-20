import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stage, unstage, commit, createBranch, switchBranch, pull, pullRebase, push, fetchRepository, resetForReassembly, serializeGit, GitOperationError } from './git-write';
import { changedFiles, repositoryInfo, trackingInfo, branches } from './git';
import { defaultGitSettings } from '../projects/git-settings';
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trim();
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-write-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Human'); git(root, 'config', 'user.email', 'human@test.invalid');
  return root;
}
test('stage/unstage before first commit, literals, user author, embedded coauthor removal and busy guard', async t => {
  const root = await fixture(t), file = 'literal[1].txt'; await fs.writeFile(path.join(root, file), 'content');
  await stage(root, [file]); assert.equal((await changedFiles(root))[0].indexStatus, 'A');
  await unstage(root, [file]); assert.equal((await changedFiles(root))[0].status, '?');
  await stage(root, [file]);
  await assert.rejects(commit(root, { title: 'fix' }, () => defaultGitSettings, { assertIdle: () => { throw new Error('busy'); } }), /busy/);
  assert.equal((await repositoryInfo(root))?.head, null);
  await assert.rejects(commit(root, { title: 'Generated with Claude Code' }, () => defaultGitSettings), (e: unknown) => e instanceof GitOperationError && e.code === 'forbidden_message');
  // A format mismatch is a warning, tested independently below.
  await assert.rejects(commit(root, { title: 'fix', body: 'Co-Authored-By: Claude <x@y>', includeDescription: true }, () => defaultGitSettings), (e: unknown) => e instanceof GitOperationError && e.code === 'forbidden_message');
  await commit(root, { title: 'fix', body: 'Co-Authored-By: Claude <x@y>', includeDescription: true }, () => defaultGitSettings, {}, true);
  assert.equal(git(root, 'log', '-1', '--format=%an <%ae>'), 'Human <human@test.invalid>');
  assert.equal((await repositoryInfo(root))?.message, 'fix');
  await fs.writeFile(path.join(root, file), 'changed'); await stage(root, [file]); await unstage(root, [file]);
  assert.equal((await changedFiles(root))[0].worktreeStatus, 'M');
  await assert.rejects(stage(root, ['../outside']), /Invalid code path/);
});
test('origin branch, upstream push, ff-only divergence, restricted reset and output', async t => {
  const root = await fixture(t); await fs.writeFile(path.join(root, 'a'), '1'); await stage(root, ['a']); await commit(root, { title: 'initial' }, () => defaultGitSettings);
  const base = (await repositoryInfo(root))!.head!;
  const remote = path.join(root, 'remote.git'); git(root, 'init', '--bare', remote); git(root, 'remote', 'add', 'origin', remote);
  let output = ''; await push(root, { onOutput: chunk => output += chunk }); assert.ok(output.length);
  assert.equal((await trackingInfo(root))?.upstream, 'origin/main');
  await fetchRepository(root); assert.ok((await branches(root)).some(branch => branch.name === 'origin/main'));
  await createBranch(root, 'feature/test', 'origin/main'); assert.equal((await repositoryInfo(root))?.branch, 'feature/test');
  await assert.rejects(switchBranch(root, 'main', { assertIdle: () => { throw new Error('busy'); } }), /busy/);
  await switchBranch(root, 'main'); await pull(root);
  // Remote main advances from another branch while local main advances independently.
  await createBranch(root, 'remote-side', 'main'); await fs.writeFile(path.join(root, 'r'), 'remote'); await stage(root, ['r']); await commit(root, { title: 'remote' }, () => defaultGitSettings);
  git(root, 'push', 'origin', 'HEAD:main'); await switchBranch(root, 'main');
  await fs.writeFile(path.join(root, 'l'), 'local'); await stage(root, ['l']); await commit(root, { title: 'local' }, () => defaultGitSettings);
  const current = (await repositoryInfo(root))!.head!;
  await assert.rejects(pull(root), (e: unknown) => e instanceof GitOperationError && e.code === 'diverged');
  await assert.rejects(resetForReassembly(root, base, base), /HEAD changed/);
  await resetForReassembly(root, base, current); assert.equal((await repositoryInfo(root))?.head, base); assert.equal(await fs.readFile(path.join(root, 'l'), 'utf8'), 'local');
  // Local commit on top of the advanced origin/main: rebase replays it instead of failing like ff-only.
  await stage(root, ['l']); await commit(root, { title: 'local again' }, () => defaultGitSettings);
  await pullRebase(root);
  assert.equal(git(root, 'rev-list', '--count', 'origin/main..HEAD'), '1');
  assert.equal(git(root, 'rev-list', '--count', 'HEAD..origin/main'), '0');
});
test('repository queue survives a failure and observes aborted queued operations', async t => {
  const root = await fixture(t); const events: string[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
  const first = serializeGit(root, async () => { events.push('first'); await gate; throw Error('fail'); });
  const controller = new AbortController(); const second = stage(root, ['a'], { signal: controller.signal }); controller.abort();
  await fs.writeFile(path.join(root, 'a'), 'a'); release();
  await assert.rejects(first); await assert.rejects(second);
  await stage(root, ['a']); assert.equal(events.length, 1);
});

test('fetch discovers all origin branches with a narrow refspec and remote selection creates or reuses a local branch', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'a'), 'base'); await stage(root, ['a']);
  await commit(root, { title: 'base' }, () => defaultGitSettings);
  const remote = path.join(root, 'origin.git'); git(root, 'init', '--bare', remote);
  git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(root, 'remote', 'add', 'origin', remote); await push(root);
  git(root, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
  git(remote, 'branch', 'release', 'main');
  assert.ok(!(await branches(root)).some(b => b.name === 'origin/release'));
  await fetchRepository(root, { assertIdle: () => { throw Error('finish owns the worktree'); } });
  assert.ok((await branches(root)).some(b => b.name === 'origin/release'));
  await switchBranch(root, 'origin/release');
  assert.equal((await repositoryInfo(root))?.branch, 'release');
  assert.equal((await trackingInfo(root))?.upstream, 'origin/release');
  await switchBranch(root, 'main'); await switchBranch(root, 'origin/release');
  assert.equal((await repositoryInfo(root))?.branch, 'release');
  await createBranch(root, 'new-work', 'origin/release');
  assert.equal((await repositoryInfo(root))?.branch, 'new-work');
  git(remote, 'branch', '-d', 'release'); await fetchRepository(root);
  assert.ok(!(await branches(root)).some(b => b.name === 'origin/release'));
  assert.ok((await branches(root)).some(b => b.name === 'release' && !b.remote));
});

test('hook output, timeout and cancellation terminate the operation and release its queue', async t => {
  const root = await fixture(t); await fs.writeFile(path.join(root, 'a'), 'a'); await stage(root, ['a']);
  const hook = path.join(root, '.git/hooks/pre-commit');
  await fs.writeFile(hook, '#!/bin/sh\necho hook-output >&2\nexit 1\n', { mode: 0o755 });
  await assert.rejects(commit(root, { title: 'fix' }, () => defaultGitSettings), (e: unknown) => e instanceof GitOperationError && e.output.includes('hook-output'));
  await fs.writeFile(hook, '#!/bin/sh\necho waiting >&2\nsleep 20\n', { mode: 0o755 });
  const start = Date.now();
  await assert.rejects(commit(root, { title: 'fix' }, () => defaultGitSettings, { timeoutMs: 300 }), (e: unknown) => e instanceof GitOperationError && e.code === 'timeout');
  const controller = new AbortController();
  const operation = commit(root, { title: 'fix' }, () => defaultGitSettings, { signal: controller.signal });
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(operation, (e: unknown) => e instanceof GitOperationError && e.code === 'cancelled');
  assert.ok(Date.now() - start < 5000, 'Cancellation must not wait for the hook to complete');
  await fs.unlink(hook); await commit(root, { title: 'after cancel' }, () => defaultGitSettings);
});

test('format mismatch is a warning and explicit human coauthor is committed', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'a'), 'a'); await stage(root, ['a']);
  await commit(root, { title: 'fix', includeCoauthors: true, coauthors: [{ name: 'Peer', email: 'peer@test.invalid' }] }, () => ({ ...defaultGitSettings, commit_pattern: '^TASK-' }));
  assert.match(git(root, 'log', '-1', '--format=%B'), /Co-authored-by: Peer <peer@test.invalid>/);
});
