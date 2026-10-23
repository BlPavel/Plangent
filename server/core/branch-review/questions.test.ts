import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const data = fsSync.mkdtempSync(path.join(os.tmpdir(), 'plangent-branch-questions-data-'));
process.env.PLANGENT_DATA_DIR = data;
const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true });

test('branch questions: queued thread, edits, agent replies through the session', async t => {
  const { getDb } = await import('../../infrastructure/db/schema');
  const review = await import('./index');
  const q = await import('./questions');
  const { createSession, initSessions } = await import('../agent-sessions/sessions');
  initSessions();
  const { createAgent } = await import('../agents');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-branch-questions-repo-'));
  t.after(async () => { getDb().close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(data, { recursive: true, force: true }); });
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'base');
  git(root, 'switch', '-c', 'feature');
  await fs.writeFile(path.join(root, 'a.txt'), 'one\ntwo\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'work');
  getDb().prepare("INSERT INTO projects (id,kind,name,key,repo_path) VALUES ('p1','project','P','p',?)").run(root);
  const { review: { id } } = await review.openReview('p1', { branch: 'refs/heads/feature', base: 'refs/heads/main' });

  await assert.rejects(q.add('p1', id, { text: ' ' }), /Напишите/);
  await assert.rejects(q.add('p1', id, { path: 'nope.txt', side: 'new', line: 1, text: 'why?' }), /не найден/);
  await assert.rejects(q.add('other', id, { text: 'x' }), /не найдено/);
  let state = await q.add('p1', id, { path: 'a.txt', side: 'new', line: 2, text: 'Что это?' });
  state = await q.add('p1', id, { text: 'Общий вопрос' });
  assert.equal(state.questions.length, 2);
  const [line, general] = state.questions;
  assert.equal(line.path, 'a.txt'); assert.equal(general.path, '');
  assert.ok(state.messages.every(m => m.author === 'developer' && !m.sent));

  const first = state.messages.find(m => m.question_id === line.id)!;
  state = q.edit('p1', id, line.id, first.id, 'Что делает эта строка?');
  assert.equal(state.messages.find(m => m.id === first.id)?.text, 'Что делает эта строка?');
  state = q.removeMessage('p1', id, general.id, state.messages.find(m => m.question_id === general.id)!.id);
  assert.deepEqual(state.questions.map(x => x.id), [line.id]);

  // As if sent: the agent session of the review picks the thread up through the MCP view.
  const agent = createAgent({ name: 'Mock', command: process.execPath });
  const session = createSession({ project_id: 'p1', agent_id: agent.id, role: 'chat', policy: 'read-only', metadata: { mr_private: true, branch_review: id } });
  getDb().prepare('UPDATE branch_question_messages SET sent=1 WHERE id=?').run(first.id);
  const { allowed } = await import('../../infrastructure/mcp/server');
  assert.deepEqual(allowed(session), ['get_review_brief', 'get_branch_questions', 'reply_branch_question', 'set_review_overview', 'add_review_remark']);
  const view = q.agentView(session);
  assert.equal(view.assigned.length, 1);
  assert.equal(view.assigned[0].where, 'a.txt:2 (новая версия)');
  assert.throws(() => q.agentReply(session, line.id, { kind: 'change', text: 'x' }), /Invalid reply/);
  q.agentReply(session, line.id, { kind: 'answer', text: 'Добавляет вторую строку.' });
  assert.throws(() => q.agentReply(session, line.id, { kind: 'answer', text: 'ещё раз' }), /not waiting/);
  assert.equal(q.agentView(session).assigned.length, 0);

  // The developer replies; the reply waits in the queue and a closed thread reopens.
  q.close('p1', id, line.id, true);
  state = q.reply('p1', id, line.id, 'А зачем?');
  assert.equal(state.questions[0].closed, false);
  assert.equal(state.messages.at(-1)?.sent, false);
  await assert.rejects(q.send('p1', id, { question_ids: ['unknown'] }), /Нечего/);
  await assert.rejects(q.send('p1', id, {}), /Выберите агента/);
});
