import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { CodeHost, MergeRequest, ReviewNote } from '../../models/code-host';

const data = fsSync.mkdtempSync(path.join(os.tmpdir(), 'plangent-mr-review-data-'));
process.env.PLANGENT_DATA_DIR = data;
const git = (root: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

test('MR review: list with approvals, open from origin, remarks on diff lines, publication and approval of the reviewed head', async t => {
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createMrReviews } = await import('./mr');
  const { createRemarks, agentRemark } = await import('./remarks');
  const agent = await import('./agent');
  const { createSession, initSessions } = await import('../agent-sessions/sessions');
  initSessions();
  const { createAgent } = await import('../agents');
  const { allowed } = await import('../../infrastructure/mcp/server');
  const origin = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-mr-origin-'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-mr-repo-'));
  t.after(async () => { getDb().close(); for (const dir of [root, origin, data]) await fs.rm(dir, { recursive: true, force: true }); });
  git(origin, 'init', '--bare', '-b', 'main');
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'remote', 'add', 'origin', origin);
  const lines = Array.from({ length: 20 }, (_, i) => 'line ' + (i + 1));
  await fs.writeFile(path.join(root, 'a.txt'), lines.join('\n') + '\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'base');
  git(root, 'push', 'origin', 'main');
  git(root, 'switch', '-c', 'feature');
  lines[1] = 'line 2 changed';
  await fs.writeFile(path.join(root, 'a.txt'), lines.join('\n') + '\n'); git(root, 'add', '-A'); git(root, 'commit', '-m', 'work');
  git(root, 'push', 'origin', 'feature'); git(root, 'switch', 'main');
  getDb().prepare("INSERT INTO projects (id,kind,name,key,repo_path) VALUES ('p1','project','P','p',?)").run(root);
  const head = git(root, 'rev-parse', 'feature'), base = git(root, 'rev-parse', 'main');

  const me = { id: 7, name: 'Я', username: 'me' };
  const mr: MergeRequest = { iid: 5, title: 'Feature', description: 'Зачем', web_url: 'https://gitlab.test/p/-/merge_requests/5', state: 'opened', author: { id: 1, name: 'Иванов', username: 'ivanov' },
    source_branch: 'feature', target_branch: 'main', sha: head, updated_at: '2026-10-20T10:00:00Z', reviewers: [me], user_notes_count: 2, diff_refs: { base_sha: base, start_sha: base, head_sha: head } };
  const drafts: ReviewNote[] = [], published: number[] = [], approved: string[] = [];
  const host = {
    listOpenMergeRequests: async () => [mr, { ...mr, iid: 6, title: 'Draft: other', reviewers: [] }],
    getApprovals: async (iid: number) => iid === 5 ? { approved_by: [{ id: 2, name: 'Петров', username: 'petrov' }], required: 2, left: 1, mine: false } : null,
    currentUser: async () => me,
    getMergeRequest: async () => mr,
    listDiscussions: async () => [{ id: 'd1', notes: [{ id: 11, body: 'Почему так?', resolvable: true, author: { id: 2, name: 'Петров', username: 'petrov' }, position: { position_type: 'text' as const, ...mr.diff_refs, old_path: 'a.txt', new_path: 'a.txt', new_line: 2 } }] }],
    detectCapabilities: async () => ({ batchReview: true, approve: true }),
    createDraftNotes: async (_iid: number, notes: ReviewNote[], created: (index: number, id: number) => void) => { notes.forEach((n, i) => { drafts.push(n); created(i, 100 + drafts.length); }); },
    publishDrafts: async (_iid: number, ids: number[], done: (id: number) => void) => { ids.forEach(id => { published.push(id); done(id); }); },
    approve: async (_iid: number, sha: string) => { approved.push(sha); },
  } as unknown as CodeHost;
  const resolve = async () => ({ host });
  const service = createMrReviews(resolve), notes = createRemarks(resolve);

  const listed = await service.list('p1');
  assert.deepEqual(listed.errors, []);
  assert.equal(listed.items.length, 2);
  const first = listed.items.find(i => i.iid === 5)!;
  assert.deepEqual(first.approvals, { count: 1, required: 2, left: 1, mine: false, names: ['Петров'] });
  assert.equal(first.reviewer, true);
  assert.deepEqual(listed.items.map(i => i.iid), [6, 5]);
  assert.deepEqual(first.threads, { open: 1, mine_open: 0 });
  assert.equal(listed.items.find(i => i.iid === 6)?.threads, null);
  assert.equal(first.mine, false);

  const opened = await service.open('p1', 5);
  const id = opened.review.id;
  assert.equal(opened.review.mr_iid, 5);
  assert.equal(opened.review.branch, 'refs/remotes/origin/feature');
  assert.equal(opened.review.merge_base, base);
  assert.deepEqual(opened.files.map(f => f.path), ['a.txt']);
  assert.equal((await service.list('p1')).items.find(i => i.iid === 5)?.review_id, id);
  const info = await service.info('p1', id);
  assert.equal(info.threads[0].path, 'a.txt');
  assert.equal(info.threads[0].notes[0].mine, false);

  await assert.rejects(notes.add('p1', id, { path: 'a.txt', side: 'new', line: 15, body: 'далеко от diff' }), /только в diff/);
  let state = await notes.add('p1', id, { path: 'a.txt', side: 'new', line: 2, body: 'Переименуйте' });
  state = await notes.add('p1', id, { body: 'Разбейте МР на два' });
  assert.equal(state.remarks.length, 2);
  await assert.rejects(notes.publish('p1', id, state.remarks.map(r => r.id), false), /Подтвердите/);
  state = await notes.publish('p1', id, state.remarks.map(r => r.id), true);
  assert.ok(state.remarks.every(r => r.status === 'sent'));
  assert.equal(drafts[0].position?.new_line, 2);
  assert.equal(drafts[0].position?.head_sha, head);
  assert.equal(drafts[1].position, undefined);
  assert.equal(published.length, 2);
  assert.equal(getDb().prepare('SELECT published_head FROM branch_reviews WHERE id=?').pluck().get(id), head);
  await assert.rejects(notes.edit('p1', id, state.remarks[0].id, { body: 'x' }), /уже отправлено/);

  await service.approve('p1', id, true);
  assert.deepEqual(approved, [head]);
  mr.diff_refs = { ...mr.diff_refs, head_sha: 'f'.repeat(40) };
  await assert.rejects(service.approve('p1', id, true), /новые коммиты/);
  mr.diff_refs = { ...mr.diff_refs, head_sha: head };

  // The review agent drafts remarks and the overview through its own tools only.
  const mock = createAgent({ name: 'Mock', command: process.execPath });
  const session = createSession({ project_id: 'p1', agent_id: mock.id, role: 'chat', policy: 'read-only', metadata: { mr_private: true, branch_review: id } });
  assert.deepEqual(allowed(session), ['get_review_brief', 'get_branch_questions', 'reply_branch_question', 'set_review_overview', 'add_review_remark']);
  await assert.rejects(agentRemark(session, { text: 'x', path: 'a.txt', line: 15 }), /not in the diff/);
  assert.equal((await agentRemark(session, { text: 'Нет теста', path: 'a.txt', line: 2 })).saved, true);
  await agent.setOverview(session, 'Меняет вторую строку.');
  const brief = await agent.brief(session);
  assert.equal(brief.range.head, head);
  assert.match(brief.skill.content, /Ревью/);
  assert.equal(brief.remarks.filter(r => r.author === 'agent').length, 1);
  assert.equal(getDb().prepare('SELECT overview FROM branch_reviews WHERE id=?').pluck().get(id), 'Меняет вторую строку.');
});
