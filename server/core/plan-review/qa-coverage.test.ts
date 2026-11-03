import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../infrastructure/db/schema';
import { createPlanReviewService } from './index';

function fixture(ready: boolean) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.exec("INSERT INTO projects(id,name,repo_path) VALUES ('p','Project','/unused'); INSERT INTO tasks(id,project_id,key) VALUES ('t','p','TASK');");
  db.prepare('INSERT INTO plans(id,task_id,content) VALUES (?,?,?)').run('plan', 't', '- [ ] (p1) First [[qa#Q1]]\n- [ ] (p2) Second [[qa#Q2]]');
  db.prepare('INSERT INTO materials(id,task_id,type,content,version,author) VALUES (?,?,?,?,?,?)')
    .run('qa', 't', 'qa', '# QA\n\n**Q1** One.\n\n**Q2** Two.\n\n**Q3** Three.', 1, 'developer');
  if (ready) db.prepare("INSERT INTO preparation_marks(task_id,stage,status,material_version) VALUES ('t','qa','ready','v')").run();
  const service = createPlanReviewService(db);
  return { service, review: service.create('p', 't').review };
}
test('a ready QA needs a coverage row per criterion; an uncovered criterion needs a card', () => {
  const { service, review } = fixture(true);
  assert.deepEqual(service.readyCriteria('t'), ['Q1', 'Q2', 'Q3']);
  const row = (criterion: string, steps: string[], status = 'covered', extra = {}) => ({ source: 'qa', criterion, requirement: criterion, steps, status, ...extra });
  const rows = [row('Q1', ['p1']), row('Q2', ['p2'])];
  assert.throws(() => service.setOverview('p', 't', review.id, { overview: 'S', coverage: rows }), /without a coverage row: Q3/);
  assert.throws(() => service.setOverview('p', 't', review.id, { overview: 'S', coverage: [...rows, row('Q3', [], 'missing')] }), /needs a remark/);
  assert.throws(() => service.setOverview('p', 't', review.id, { overview: 'S', coverage: [...rows, row('Q9', ['p1'])] }), /Unknown QA criterion/);
  assert.throws(() => service.setOverview('p', 't', review.id, { overview: 'S', coverage: [row('Q1', []), row('Q2', ['p2']), row('Q3', ['p2'])] }), /names no step/);
  const card = service.addRemark('p', 't', review.id, { steps: [], kind: 'coverage', text: 'Q3 is not closed by any step' });
  const saved = service.setOverview('p', 't', review.id, { overview: 'S', coverage: [...rows, row('Q3', [], 'missing', { remark_id: card.id })] });
  assert.equal(saved.review.coverage.find(r => r.criterion === 'Q3')!.remark_id, card.id);
  assert.equal(saved.review.coverage[0].source, 'qa');
});
test('without a ready QA the plan review works as before and QA rows are rejected', () => {
  const { service, review } = fixture(false);
  assert.deepEqual(service.readyCriteria('t'), []);
  service.setOverview('p', 't', review.id, { overview: 'S', coverage: [{ requirement: 'R', steps: ['p1'], status: 'covered' }] });
  assert.throws(() => service.setOverview('p', 't', review.id, { overview: 'S', coverage: [{ source: 'qa', criterion: 'Q1', requirement: 'R', steps: ['p1'], status: 'covered' }] }), /Unknown QA criterion/);
});
