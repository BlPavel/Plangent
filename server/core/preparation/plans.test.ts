import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { PlanSaved } from './plan-events';

const nodeRequire = createRequire(__filename);

// Keep the real save/read policy with an isolated repository; no application database or Git.
function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const events: PlanSaved[] = [];
  const queries = {
    rowSelectPlans: (taskId: string) => [...rows.values()].filter(p => p.task_id === taskId).sort((a, b) => Number(b.version) - Number(a.version))[0],
    rowSelectPlans2: (id: string) => rows.get(id),
    createPlanInsertPlans: (id: string, task_id: string, content: string, version: number, session_id: string | null, author: string) =>
      rows.set(id, { id, task_id, content, version, session_id, author }),
    updatePlanUpdatePlans: (content: string, session_id: string | null, author: string, id: string) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, content, session_id, author });
    },
  };
  const module = { exports: {} as typeof import('./plans') };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'plans.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const load = (name: string) => {
    if (name === '../../infrastructure/db/repositories/preparation/plans') return queries;
    if (name === './plan-events') return { emitPlanSaved: (event: PlanSaved) => events.push(event) };
    return nodeRequire(name);
  };
  vm.runInThisContext('(function(require, module, exports) {' + source + '\n})')(load, module, module.exports);
  return { ...module.exports, events };
}

test('manual plan creation and edits persist selectable step ids before notifying consumers', () => {
  const plans = fixture();
  const created = plans.createPlan({ task_id: 'task', content: '- [ ] First\n- [ ] (p7) Kept\n- [x]  (p2) Done\n- [ ] Last' });
  const ids = (content: string) => plans.parsePlanSteps(content).map(s => s.id);
  assert.deepEqual(ids(created.content), ['p8', 'p7', 'p2', 'p9']);
  assert.equal(plans.getLatestPlan('task')!.content, created.content);
  assert.equal(plans.events[0].content, created.content);

  const edited = plans.updatePlan(created.id, created.content + '\n- [ ] Added')!;
  assert.deepEqual(ids(edited.content), ['p8', 'p7', 'p2', 'p9', 'p10']);
  assert.equal(plans.getPlan(created.id)!.content, edited.content);
  assert.equal(plans.events.at(-1)!.content, edited.content);
  assert.equal(edited.author, 'developer');
  assert.equal(edited.session_id, null);
  assert.equal(plans.parsePlanSteps(edited.content)[2].done, true);

  const count = plans.events.length;
  assert.equal(plans.updatePlan(created.id, edited.content)!.content, edited.content);
  assert.equal(plans.events.length, count, 'saving again keeps ids stable and emits no spurious content change');
  assert.equal(plans.updatePlan(created.id, '')!.content, '', 'an empty plan can still be saved');
});

test('numbering is idempotent for existing ids with extra whitespace', () => {
  const { assignMissingIds } = fixture();
  const content = '- [ ]   (p1) First\n  - [x]  (p8) Done\n- [ ] (custom) Existing';
  assert.deepEqual(assignMissingIds(content), { content, changed: false });
  const numbered = assignMissingIds(content + '\n- [ ] New');
  assert.ok(numbered.content.endsWith('- [ ] (p9) New'));
  assert.deepEqual(assignMissingIds(numbered.content), { content: numbered.content, changed: false });
});
