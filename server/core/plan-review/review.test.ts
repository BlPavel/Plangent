import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../infrastructure/db/schema';
import { createPlanReviewService } from './index';
import type { PlanSaved } from '../orchestration/plan-events';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  migrate(db);
  db.exec("INSERT INTO projects(id,name,repo_path) VALUES ('p','Project','/unused'),('other','Other','/unused'); INSERT INTO tasks(id,project_id,key) VALUES ('t','p','TASK'),('other-task','other','OTHER');");
  const content = '- [ ] (p1) First\nDescription\n- [ ] (p2) Second\n- [ ] (p3) Third';
  db.prepare('INSERT INTO plans(id,task_id,content) VALUES (?,?,?)').run('plan','t',content);
  const service = createPlanReviewService(db);
  const review = service.create('p','t').review;
  const add = (steps = ['p1']) => service.addRemark('p','t',review.id,{ steps, kind: 'order', text: 'Problem', suggestion: 'Fix' });
  const detail = () => service.detail('p','t',review.id);
  const save = (changes: Partial<PlanSaved> = {}) => {
    const event: PlanSaved = { taskId: 't', content: content.replace('First','Changed'), previousContent: content, version: 2, sessionId: 'planner', idMap: {}, ...changes };
    db.prepare('UPDATE plans SET content=? WHERE id=?').run(event.content, 'plan');
    service.onSaved(event);
  };
  return { db, content, service, review, add, detail, save };
}
test('snapshots, rounds, overview, coverage and threads survive rereading; migration is idempotent', () => {
  const f = fixture();
  try {
    const a = f.add();
    f.service.setOverview('p','t',f.review.id,{ overview: 'Summary', coverage: [
      { requirement: 'One', steps: ['p1'], status: 'covered' },
      { requirement: 'Two', steps: [], status: 'missing', remark_id: a.id }
    ] });
    f.service.decision('p','t',f.review.id,a.id,{ status: 'accepted', comment: 'Clarification' });
    const read = createPlanReviewService(f.db).detail('p','t',f.review.id);
    assert.equal(read.review.overview, 'Summary');
    assert.equal(read.review.coverage[1].remark_id, a.id);
    assert.equal(read.remarks[0].messages[0].text, 'Clarification');
    assert.equal(read.remarks[0].messages[0].author, 'developer');
    f.save();
    assert.equal(f.detail().review.plan_content, f.content);
    assert.equal(f.service.create('p','t').review.round, 2);
    assert.equal(f.service.list('p','t').length, 2);
    assert.deepEqual(f.db.pragma('foreign_key_check'), []);
  } finally { f.db.close(); }
});
test('decisions validate discussion text, preserve rejection reasons and can be reopened', () => {
  const f = fixture();
  try {
    const a = f.add();
    for (const status of ['accepted','rejected','open','discussing']) {
      f.service.decision('p','t',f.review.id,a.id,{ status, comment: 'Why' });
      assert.equal(f.detail().remarks[0].status, status);
      assert.equal(f.detail().remarks[0].decision, 'Why');
    }
    assert.throws(() => f.service.decision('p','t',f.review.id,a.id,{ status: 'discussing' }));
    assert.throws(() => f.service.decision('p','t',f.review.id,a.id,{ status: 'applied' }));
    assert.equal(f.detail().remarks[0].status, 'discussing');
  } finally { f.db.close(); }
});
test('accepted delivery applies only on changed plan save by recipient; discussion waits for a reply', () => {
  const f = fixture();
  try {
    const a = f.add(), b = f.add(['p2']);
    f.service.decision('p','t',f.review.id,a.id,{ status: 'accepted' });
    f.service.decision('p','t',f.review.id,b.id,{ status: 'accepted', comment: 'Why?' });
    f.service.sent('p','t',f.review.id,[a.id,b.id],'planner');
    assert.ok(f.detail().remarks.every(r => r.status === 'sent'));
    assert.ok(f.detail().remarks[1].messages.every(m => m.sent));
    f.save({ content: f.content });
    assert.equal(f.detail().remarks[0].status, 'sent');
    f.save({ sessionId: 'another-planner' });
    assert.equal(f.detail().remarks[0].status, 'sent');
    f.service.addMessage('p','t',f.review.id,a.id,'planner','answer: I will fix it');
    assert.equal(f.detail().remarks[0].status, 'sent');
    f.service.addMessage('p','t',f.review.id,b.id,'planner','disagree: Explanation');
    assert.equal(f.detail().remarks[1].status, 'answered');
    assert.equal(f.detail().remarks[1].messages.at(-1)!.text, 'disagree: Explanation');
    f.save();
    const applied = f.detail().remarks[0];
    assert.equal(applied.status, 'applied');
    assert.equal(applied.applied_version, 2);
    assert.equal(f.detail().remarks[1].status, 'answered');
    f.service.decision('p','t',f.review.id,b.id,{ status: 'accepted', comment: 'Now fix' });
    assert.equal(f.detail().remarks[1].status, 'accepted');
  } finally { f.db.close(); }
});
test('delivery validates all cards before changing any; rejected remarks cannot be sent', () => {
  const f = fixture();
  try {
    const a = f.add(), b = f.add();
    f.service.decision('p','t',f.review.id,a.id,{ status: 'accepted' });
    f.service.decision('p','t',f.review.id,b.id,{ status: 'rejected', comment: 'Intentional' });
    assert.throws(() => f.service.sent('p','t',f.review.id,[a.id,b.id],'planner'));
    assert.equal(f.detail().remarks[0].status, 'accepted');
    assert.equal(f.detail().remarks[1].status, 'rejected');
    assert.throws(() => f.service.sent('p','t',f.review.id,[],'planner'));
    assert.throws(() => f.service.sent('p','t',f.review.id,[a.id,a.id],'planner'));
  } finally { f.db.close(); }
});
test('idMap remaps references simultaneously; a deleted id stays deleted when its number is reused', () => {
  const f = fixture();
  try {
    f.add(['p1','p2','p3']);
    f.save({ content: '- [ ] (p1) New\n- [ ] (p2) First\nDescription\n- [ ] (p3) Second\n- [ ] (p4) Third', idMap: { p1: 'p2', p2: 'p3', p3: 'p4' } });
    assert.deepEqual(f.detail().remarks[0].steps.map(s => s.id), ['p2','p3','p4']);
    assert.ok(f.detail().remarks[0].steps.every(s => !s.deleted));
    assert.equal(f.detail().remarks[0].outdated, false);
  } finally { f.db.close(); }
  const g = fixture();
  try {
    g.add(['p2','p3']);
    g.save({ content: '- [ ] (p1) First\nDescription\n- [ ] (p2) Third', idMap: { p3: 'p2' } });
    assert.deepEqual(g.detail().remarks[0].steps, [{ id: 'p2', deleted: true }, { id: 'p2', deleted: false }]);
    g.save({ previousContent: '- [ ] (p1) First\nDescription\n- [ ] (p2) Third', content: g.content });
    assert.equal(g.detail().remarks[0].steps[0].deleted, true);
  } finally { g.db.close(); }
});
test('changed step descriptions and deleted steps become outdated; general remarks track the whole plan', () => {
  const f = fixture();
  try {
    f.add(['p1']); f.add(['p2']); f.add([]);
    f.save({ content: f.content.replace('Description','New description') });
    assert.equal(f.detail().remarks[0].outdated, true);
    assert.equal(f.detail().remarks[1].outdated, false);
    assert.equal(f.detail().remarks[2].outdated, true);
    assert.ok(f.detail().remarks.every(r => r.status === 'open'));
    f.save({ content: '- [ ] (p1) First' });
    assert.deepEqual(f.detail().remarks[1].steps, [{ id: 'p2', deleted: true }]);
  } finally { f.db.close(); }
});
test('coverage problems require a linked card, and step ids must exist in the snapshot', () => {
  const f = fixture();
  try {
    assert.throws(() => f.add(['p99']));
    const a = f.add();
    assert.throws(() => f.service.setOverview('p','t',f.review.id,{ overview: 'Summary', coverage: [{ requirement: 'R', steps: [], status: 'missing' }] }));
    assert.throws(() => f.service.setOverview('p','t',f.review.id,{ overview: 'Summary', coverage: [{ requirement: 'R', steps: ['p99'], status: 'covered' }] }));
    assert.throws(() => f.service.setOverview('p','t',f.review.id,{ overview: 'Summary', coverage: [{ requirement: 'R', steps: [], status: 'partial', remark_id: 'foreign' }] }));
    f.service.setStatus('p','t',f.review.id,'completed');
    assert.throws(() => f.add());
    f.service.decision('p','t',f.review.id,a.id,{ status: 'accepted' });
    assert.equal(f.detail().remarks[0].status, 'accepted');
  } finally { f.db.close(); }
});
test('service isolates task/project scopes and cascades task deletion through threads', () => {
  const f = fixture();
  try {
    const a = f.add();
    f.service.addMessage('p','t',f.review.id,a.id,'developer','Question');
    assert.throws(() => f.service.detail('other','t',f.review.id));
    assert.throws(() => f.service.detail('other','other-task',f.review.id));
    assert.throws(() => f.service.decision('p','t',f.review.id,'missing',{ status: 'open' }));
    f.db.prepare('DELETE FROM tasks WHERE id=?').run('t');
    for (const table of ['plan_reviews','plan_review_remarks','plan_review_messages']) {
      assert.equal((f.db.prepare('SELECT count(*) AS n FROM '+table).get() as { n: number }).n, 0);
    }
  } finally { f.db.close(); }
});
test('running and paused queues block new rounds', () => {
  const f = fixture();
  try {
    f.db.exec('CREATE TABLE task_queues(task_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    f.db.prepare('INSERT INTO task_queues VALUES (?,?)').run('t', JSON.stringify({ status: 'running' }));
    for (const status of ['running','paused']) {
      f.db.prepare('UPDATE task_queues SET data=?').run(JSON.stringify({ status }));
      assert.throws(() => f.service.create('p','t'));
    }
    f.db.prepare('UPDATE task_queues SET data=?').run(JSON.stringify({ status: 'stopped' }));
    assert.equal(f.service.create('p','t').review.round, 2);
  } finally { f.db.close(); }
});
test('a planner disagreement with an accepted card needs the developer; sent and applied cards can be reopened', () => {
  const f = fixture();
  try {
    const a = f.add(), b = f.add(['p2']);
    f.service.decision('p','t',f.review.id,a.id,{ status: 'accepted' });
    f.service.decision('p','t',f.review.id,b.id,{ status: 'accepted' });
    f.service.sent('p','t',f.review.id,[a.id,b.id],'planner');
    f.service.addMessage('p','t',f.review.id,a.id,'planner','disagree: the order is intentional');
    assert.equal(f.detail().remarks[0].status, 'answered');
    f.service.decision('p','t',f.review.id,a.id,{ status: 'discussing', comment: 'Explain more' });
    assert.equal(f.detail().remarks[0].status, 'discussing');
    // A card nobody answered can be taken back, and so can one already applied.
    f.service.decision('p','t',f.review.id,b.id,{ status: 'open' });
    assert.equal(f.detail().remarks[1].status, 'open');
    f.service.decision('p','t',f.review.id,b.id,{ status: 'accepted' });
    f.service.sent('p','t',f.review.id,[b.id],'planner');
    f.save();
    assert.equal(f.detail().remarks[1].status, 'applied');
    f.service.decision('p','t',f.review.id,b.id,{ status: 'discussing', comment: 'Still wrong' });
    assert.equal(f.detail().remarks[1].status, 'discussing');
    assert.equal(f.detail().remarks[1].applied_version, null);
  } finally { f.db.close(); }
});
test('a card can be rewritten before it goes to the planner; the first version is kept once', () => {
  const f = fixture();
  try {
    const a = f.add();
    f.service.revise('p','t',f.review.id,a.id,{ text: 'Second', suggestion: 'Do this' });
    f.service.revise('p','t',f.review.id,a.id,{ text: 'Third' });
    const card = f.detail().remarks[0];
    assert.equal(card.text, 'Third'); assert.equal(card.suggestion, '');
    assert.deepEqual(card.original, { text: a.text, suggestion: a.suggestion });
    assert.throws(() => f.service.revise('p','t',f.review.id,a.id,{ text: ' ' }));
    f.service.decision('p','t',f.review.id,a.id,{ status: 'accepted' });
    assert.equal(f.detail().remarks[0].original!.text, a.text);
    f.service.sent('p','t',f.review.id,[a.id],'planner');
    assert.throws(() => f.service.revise('p','t',f.review.id,a.id,{ text: 'Late' }), /already went/);
  } finally { f.db.close(); }
});
