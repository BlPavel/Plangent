import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const data = fsSync.mkdtempSync(path.join(os.tmpdir(), 'plangent-branch-remark-data-'));
process.env.PLANGENT_DATA_DIR = data;
const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });

test('branch remarks: rejected ones are kept but never published, a discussion can rewrite a remark', async t => {
  const { getDb } = await import('../../../infrastructure/db/schema');
  const review = await import('../../../core-services').then(() => import('../../../core/review/branch/index'));
  const q = await import('../../../core-services').then(() => import('../../../core/review/branch/questions'));
  const { remarks, agentRevise } = await import('../../../core-services').then(() => import('../../../core/review/branch/remarks'));
  const { createSession, initSessions } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  initSessions();
  const { createAgent } = await import('../../../core-services').then(() => import('../../../core/agents/catalog'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-branch-remark-repo-'));
  t.after(async () => { getDb().close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(data, { recursive: true, force: true }); });
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'base');
  git(root, 'switch', '-c', 'feature');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'work');
  getDb().prepare("INSERT INTO projects (id,kind,name,key,repo_path) VALUES ('p1','project','P','p',?)").run(root);
  const { review: { id } } = await review.openReview('p1', { branch: 'refs/heads/feature', base: 'refs/heads/main' });
  const agent = createAgent({ name: 'Mock', command: process.execPath });
  const session = createSession({ project_id: 'p1', agent_id: agent.id, role: 'chat', policy: 'read-only', metadata: { mr_private: true, branch_review: id } });

  let list = (await remarks().add('p1', id, { body: 'Зачем эта строка?', path: 'a.txt', side: 'new', line: 2 })).remarks;
  const key = list[0].id;
  assert.equal(list[0].status, 'draft');
  assert.equal(list[0].original, null);

  // Rejecting keeps the remark, but it can neither be changed nor published until it is brought back.
  list = (await remarks().reject('p1', id, key, true)).remarks;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'rejected');
  await assert.rejects(remarks().edit('p1', id, key, { body: 'x' }), /отклонено/);
  await assert.rejects(remarks().markSent('p1', id, [key]), /отклонено|Выберите|публикуются/);
  await assert.rejects(remarks().reject('p1', id, key, 'yes'), /Invalid/);
  list = (await remarks().reject('p1', id, key, false)).remarks;
  assert.equal(list[0].status, 'draft');

  // A discussion of the remark is a question linked to it; the agent sees what it is about and may rewrite the remark.
  const asked = await q.add('p1', id, { path: 'a.txt', side: 'new', line: 2, text: 'Почему это плохо?', remark_id: key });
  assert.equal(asked.questions[0].remark_id, key);
  assert.equal((await q.add('p1', id, { text: 'Общий', remark_id: 'unknown' })).questions.at(-1)!.remark_id, '');
  getDb().prepare('UPDATE branch_question_messages SET sent=1 WHERE question_id=?').run(asked.questions[0].id);
  const view = q.agentView(session).assigned.find(x => x.id === asked.questions[0].id) as { about_remark?: { id: string; text: string } };
  assert.deepEqual(view.about_remark, { id: key, author: 'developer', text: 'Зачем эта строка?' });

  await agentRevise(session, { id: key, text: 'Эта строка дублирует предыдущую: уберите её.' });
  list = (await remarks().list('p1', id)).remarks;
  assert.equal(list[0].body, 'Эта строка дублирует предыдущую: уберите её.');
  assert.equal(list[0].original, 'Зачем эта строка?');
  // A second rewrite keeps the very first text.
  await agentRevise(session, { id: key, text: 'Строка лишняя.' });
  assert.equal((await remarks().list('p1', id)).remarks[0].original, 'Зачем эта строка?');

  // A thread can go once the agent has answered (its answer became a remark, say); not while the agent owes one.
  const thread = asked.questions[0].id;
  assert.throws(() => q.removeQuestion('p1', id, thread), /ещё отвечает/);
  q.agentReply(session, thread, { kind: 'answer', text: 'Лишняя.' });
  assert.ok(!q.removeQuestion('p1', id, thread).questions.some(x => x.id === thread));

  await remarks().reject('p1', id, key, true);
  await assert.rejects(agentRevise(session, { id: key, text: 'ещё' }), /отклонено/);
});
