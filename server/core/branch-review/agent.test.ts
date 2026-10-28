import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const data = fsSync.mkdtempSync(path.join(os.tmpdir(), 'plangent-branch-agent-data-'));
process.env.PLANGENT_DATA_DIR = data;
const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });

test('branch review agent: the review ends with the turn, «Новое ревью» keeps only what the developer owns', async t => {
  const { getDb } = await import('../../infrastructure/db/schema');
  const review = await import('./index');
  const agent = await import('./agent');
  const q = await import('./questions');
  const { remarks } = await import('./remarks');
  const { sessionSignals } = await import('../agent-sessions/acp-host');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-branch-agent-repo-'));
  t.after(async () => { getDb().close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(data, { recursive: true, force: true }); });
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'base');
  git(root, 'switch', '-c', 'feature');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'work');
  getDb().prepare("INSERT INTO projects (id,kind,name,key,repo_path) VALUES ('p1','project','P','p',?)").run(root);
  const { review: { id, analysis_status: before } } = await review.openReview('p1', { branch: 'refs/heads/feature', base: 'refs/heads/main' });
  assert.equal(before, '');

  // As if the agent was started: the end of its turn finishes the review, a later turn changes nothing.
  getDb().prepare("UPDATE branch_reviews SET analysis_status='running',analysis_session='s1',analysis_note='только архитектура',overview='Сводка' WHERE id=?").run(id);
  await assert.rejects(agent.analyze('p1', id, {}), /уже проведено/);
  sessionSignals.emit('turn_end', 'other');
  assert.equal((await review.detail('p1', id)).review.analysis_status, 'running');
  sessionSignals.emit('turn_end', 's1');
  assert.equal((await review.detail('p1', id)).review.analysis_status, 'done');
  sessionSignals.emit('error-state', 's1', 'boom');
  assert.equal((await review.detail('p1', id)).review.analysis_status, 'done');

  // Stopping a running review marks it stopped before the cancelled turn ends.
  getDb().prepare("UPDATE branch_reviews SET analysis_status='running' WHERE id=?").run(id);
  await q.stop('p1', id);
  sessionSignals.emit('turn_end', 's1');
  assert.equal((await review.detail('p1', id)).review.analysis_status, 'stopped');

  const insert = getDb().prepare("INSERT INTO branch_review_remarks(id,review_id,head,body,author,edited) VALUES (?,?,'h',?,?,?)");
  insert.run('agent-untouched', id, 'a', 'agent', 0);
  insert.run('agent-edited', id, 'b', 'agent', 0);
  insert.run('mine', id, 'c', 'developer', 0);
  await remarks().edit('p1', id, 'agent-edited', { body: 'b, поправлено' });
  await remarks().edit('p1', id, 'mine', { body: 'c' });
  const listed = (await remarks().list('p1', id)).remarks;
  assert.deepEqual(listed.map(r => [r.id, r.edited]), [['agent-untouched', false], ['agent-edited', true], ['mine', false]]);

  const fresh = await agent.restart('p1', id);
  assert.deepEqual([fresh.review.analysis_status, fresh.review.analysis_session, fresh.review.analysis_note, fresh.review.overview], ['', '', '', '']);
  assert.deepEqual((await remarks().list('p1', id)).remarks.map(r => r.id), ['agent-edited', 'mine']);
});
