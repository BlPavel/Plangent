import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

test('QA review: round, cards on Q4, delivery to the QA author, its reply, outdating after an edit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-material-review-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../../infrastructure/db/schema');
  const sessions = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const host = await import('../../../core-services').then(() => import('../../../core/agents/sessions/acp-host'));
  const { createAgent } = await import('../../../core-services').then(() => import('../../../core/agents/catalog'));
  const { createProject, updateProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { createTask } = await import('../../../core-services').then(() => import('../../../core/tasks'));
  const { initQueues } = await import('../../../core-services').then(() => import('../../../core/execution/queue'));
  const materials = await import('../../../core-services').then(() => import('../../../core/preparation/materials'));
  const stages = await import('../../../core-services').then(() => import('../../../core/preparation/materials/stages'));
  const analysis = await import('../../../core-services').then(() => import('../../../core/preparation/analysis'));
  const { stopWatchAnalysis } = await import('../../../core-services').then(() => import('../../../core/tasks/task-files'));
  const { planReviews } = await import('../../../core-services').then(() => import('../../../core/review/plan/index'));
  const { launch } = await import('../../../core-services').then(() => import('../../../core/review/plan/overview'));
  const { candidates, deliver } = await import('../../../core-services').then(() => import('../../../core/review/plan/planner-transport'));
  const { mcpRouter, sessionMcpConfig, allowed } = await import('../../../core-services').then(() => import('../../../api/mcp/server'));
  const { killProcessTree } = await import('../../../infrastructure/terminal/process-tree');
  sessions.initSessions(); initQueues();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = createAgent({ name: 'Mock', acp_command: process.execPath, acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs')] });
  const project = createProject({ name: 'Review', repo_path: root });
  updateProject(project.id, { default_agent_id: agent.id });
  const task = createTask({ project_id: project.id, key: 'QAREV' });
  const service = planReviews();
  const app = express(); app.use(express.json()); app.use('/mcp', mcpRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  process.env.PLANGENT_URL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const untilReady = async (id: string) => {
    const limit = Date.now() + 10000;
    while (sessions.getSession(id).status !== 'ready') {
      if (Date.now() > limit) throw new Error('Timed out');
      await new Promise(r => setTimeout(r, 25));
    }
  };
  const call = async (id: string, name: string, args: unknown = {}) => {
    const config = sessionMcpConfig(sessions.getSession(id), true)[0] as { headers: { name: string; value: string }[] };
    const response = await fetch(process.env.PLANGENT_URL + '/mcp', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...Object.fromEntries(config.headers.map(h => [h.name, h.value])) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const result = await response.json() as { error?: unknown; result?: { isError?: boolean; content: { text: string }[] } };
    return { failed: !!result.error || !!result.result?.isError, data: result.result?.content[0]?.text };
  };
  try {
    analysis.createAnalysisSection({ task_id: task.id, title: 'Dates', description: 'Past dates are rejected', kind: 'worked' });
    const qa = '# QA\n\n**Q1** Calendar hides past dates.\n\n**Q4** Any time before now is an error.\n\nA free paragraph about time zones.';
    materials.saveMaterial({ task_id: task.id, type: 'qa', content: qa });
    // Nothing to review before the document exists; a plan review has no plan here either.
    await assert.rejects(launch(project.id, task.id, { agent_id: agent.id, target: 'architecture' }), /does not exist/);
    assert.throws(() => service.create(project.id, task.id), /Plan not found/);
    await assert.rejects(launch(project.id, task.id, { agent_id: agent.id, target: 'wrong' }), /Invalid review target/);

    const opened = await launch(project.id, task.id, { agent_id: agent.id, target: 'qa', wish: 'Mind dates' });
    const reviewer = opened.session_id;
    await untilReady(reviewer);
    assert.equal(opened.review.target, 'qa');
    assert.equal(opened.review.round, 1);
    assert.equal(opened.review.plan_content, qa);
    assert.deepEqual(service.list(project.id, task.id).map(r => r.id), []);
    assert.deepEqual(service.list(project.id, task.id, 'qa').map(r => r.id), [opened.review.id]);
    assert.deepEqual(allowed(sessions.getSession(reviewer)), ['get_plan_review_brief', 'set_plan_review_overview', 'add_plan_remark', 'answer_plan_remark', 'revise_plan_remark']);

    // The brief carries the document, the QA review instruction and no plan; the draft architecture is not a ground.
    sessions.updateSession(reviewer, { status: 'thinking' });
    const brief = JSON.parse((await call(reviewer, 'get_plan_review_brief')).data!);
    assert.equal(brief.target, 'qa');
    assert.deepEqual(brief.document.identifiers, ['Q1', 'Q4']);
    assert.equal(brief.document.content, qa);
    assert.match(brief.instruction, /QA review/);
    assert.equal(brief.skill, null);
    assert.equal(brief.plan, undefined);
    assert.equal(brief.architecture, null);
    assert.equal(brief.wish, 'Mind dates');
    materials.saveMaterial({ task_id: task.id, type: 'architecture', content: '**D1** Dates live in the calendar component' });
    stages.markPreparationStage(task.id, 'architecture', 'ready');
    assert.match(JSON.parse((await call(reviewer, 'get_plan_review_brief')).data!).architecture.content, /calendar component/);

    // Cards point at identifiers or at a quote; plan-only things are refused.
    assert.equal((await call(reviewer, 'add_plan_remark', { steps: ['p1'], kind: 'contradiction', text: 'Bad' })).failed, true);
    assert.equal((await call(reviewer, 'add_plan_remark', { steps: ['Q9'], kind: 'contradiction', text: 'Bad' })).failed, true);
    assert.equal((await call(reviewer, 'add_plan_remark', { steps: ['Q4'], kind: 'order', text: 'Bad' })).failed, true);
    assert.equal((await call(reviewer, 'add_plan_remark', { steps: [], kind: 'unclear', text: 'Bad', quote: 'not in the document' })).failed, true);
    const a = JSON.parse((await call(reviewer, 'add_plan_remark', { steps: ['Q4'], kind: 'contradiction', text: 'Q4 forbids any earlier time, the analysis speaks of past dates', suggestion: 'Limit Q4 to dates' })).data!);
    const b = JSON.parse((await call(reviewer, 'add_plan_remark', { steps: [], kind: 'suggestion', text: 'Name the time zone', quote: 'A free   paragraph about time zones.' })).data!);
    assert.deepEqual(a.steps, [{ id: 'Q4', deleted: false }]);
    assert.equal(b.quote, 'A free paragraph about time zones.');
    assert.equal((await call(reviewer, 'set_plan_review_overview', { overview: 'Summary', coverage: [{ requirement: 'R', steps: [], status: 'covered' }] })).failed, true);
    assert.equal((await call(reviewer, 'set_plan_review_overview', { overview: 'Summary', coverage: [] })).failed, false);
    const finished = service.detail(project.id, task.id, opened.review.id);
    assert.equal(finished.review.status, 'completed');
    assert.deepEqual(finished.review.coverage, []);

    // Accepting a card sends it to the QA author: a new material-author session of this type.
    service.decision(project.id, task.id, opened.review.id, a.id, { status: 'accepted', comment: 'Only dates' });
    service.decision(project.id, task.id, opened.review.id, b.id, { status: 'rejected', comment: '' });
    assert.deepEqual(candidates(project.id, task.id, 'qa').sessions, []);
    const sent = await deliver(project.id, task.id, opened.review.id, {});
    const author = sent.session_id;
    await untilReady(author);
    const authorSession = sessions.getSession(author);
    assert.equal(authorSession.role, 'material-author');
    assert.equal(authorSession.metadata.material_type, 'qa');
    assert.equal(authorSession.policy, 'read-only');
    assert.ok(!/Q4|Q1/.test(String(authorSession.metadata.briefing)));
    assert.equal(sent.remarks.find(r => r.id === a.id)!.status, 'sent');

    sessions.updateSession(author, { status: 'thinking' });
    const items = JSON.parse((await call(author, 'get_plan_review_items')).data!);
    assert.deepEqual(items.assigned.map((r: { id: string }) => r.id), [a.id]);
    assert.deepEqual(items.assigned[0].steps, ['Q4']);
    assert.equal(items.assigned[0].developer_clarification, 'Only dates');
    assert.match(items.protocol, /submit_material/);
    assert.equal((await call(author, 'reply_plan_remark', { id: b.id, kind: 'answer', text: 'No' })).failed, true);
    assert.equal((await call(author, 'reply_plan_remark', { id: a.id, kind: 'questions', text: 'Which dates exactly?' })).failed, false);
    assert.equal(service.detail(project.id, task.id, opened.review.id).remarks.find(r => r.id === a.id)!.status, 'answered');
    // The developer decides again, the author fixes the document: the sent card is applied by its saving.
    service.decision(project.id, task.id, opened.review.id, a.id, { status: 'accepted', comment: 'Calendar dates' });
    sessions.updateSession(author, { status: 'ready' });
    const again = await deliver(project.id, task.id, opened.review.id, { session_id: author });
    assert.equal(again.session_id, author);
    await untilReady(author);
    sessions.updateSession(author, { status: 'thinking' });
    JSON.parse((await call(author, 'get_material')).data!);
    const fixed = qa.replace('Any time before now is an error.', 'A past calendar date is an error.');
    assert.equal((await call(author, 'submit_material', { content: fixed })).failed, false);
    const applied = service.detail(project.id, task.id, opened.review.id).remarks;
    assert.equal(applied.find(r => r.id === a.id)!.status, 'applied');
    assert.equal(applied.find(r => r.id === a.id)!.applied_version, 2);
    assert.equal(applied.find(r => r.id === a.id)!.outdated, true);
    // The review keeps the text it saw; the card on Q1 stays fresh while Q4 changed.
    assert.equal(service.detail(project.id, task.id, opened.review.id).review.plan_content, qa);

    // A later edit by the developer: cards on an unchanged block stay fresh, a vanished identifier is marked, a quote that went is outdated.
    const second = service.create(project.id, task.id, { target: 'qa' });
    assert.equal(second.review.round, 2);
    assert.equal(second.review.plan_content, fixed);
    const onQ1 = service.addRemark(project.id, task.id, second.review.id, { steps: ['Q1'], kind: 'unclear', text: 'Q1 note' });
    const onQ4 = service.addRemark(project.id, task.id, second.review.id, { steps: ['Q4'], kind: 'risk', text: 'Q4 note' });
    const onQuote = service.addRemark(project.id, task.id, second.review.id, { steps: [], kind: 'suggestion', text: 'Zone', quote: 'A free paragraph about time zones.' });
    materials.saveMaterial({ task_id: task.id, type: 'qa', content: fixed.replace('**Q4** A past calendar date is an error.', '**Q5** Renamed.').replace('A free paragraph about time zones.', 'Zones are documented elsewhere.') });
    const after = service.detail(project.id, task.id, second.review.id).remarks;
    assert.equal(after.find(r => r.id === onQ1.id)!.outdated, false);
    assert.equal(after.find(r => r.id === onQ4.id)!.outdated, true);
    assert.deepEqual(after.find(r => r.id === onQ4.id)!.steps, [{ id: 'Q4', deleted: true }]);
    assert.equal(after.find(r => r.id === onQuote.id)!.outdated, true);
    // An architecture review is counted apart and does not touch the QA cards.
    const architecture = service.create(project.id, task.id, { target: 'architecture' });
    assert.equal(architecture.review.round, 1);
    materials.saveMaterial({ task_id: task.id, type: 'architecture', content: '**D1** Changed' });
    assert.equal(service.detail(project.id, task.id, second.review.id).remarks.find(r => r.id === onQ1.id)!.outdated, false);

    getDb().prepare('INSERT INTO task_queues(task_id,data) VALUES (?,?)').run(task.id, JSON.stringify({ status: 'running' }));
    await assert.rejects(launch(project.id, task.id, { target: 'qa' }), /frozen/);
    getDb().prepare('DELETE FROM task_queues WHERE task_id=?').run(task.id);
    assert.deepEqual(getDb().pragma('foreign_key_check'), []);
  } finally {
    await host.shutdownSessions();
    stopWatchAnalysis(task.id);
    await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
    delete process.env.PLANGENT_URL;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migration keeps plan reviews and cards of the older shape and counts rounds per target', async () => {
  const { default: Database } = await import('better-sqlite3');
  const { migrate } = await import('../../../infrastructure/db/schema');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Tables as they were before the review target: UNIQUE(task_id,round) and the plan-only kinds.
  migrate(db);
  db.exec('PRAGMA foreign_keys = OFF; DROP TABLE plan_review_messages; DROP TABLE plan_review_remarks; DROP TABLE plan_reviews;');
  db.exec(`
    CREATE TABLE plan_reviews (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      plan_version INTEGER NOT NULL, plan_content TEXT NOT NULL, round INTEGER NOT NULL,
      session_id TEXT, skill_id TEXT, overview TEXT NOT NULL DEFAULT '',
      coverage TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(coverage)),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','failed')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')), UNIQUE(task_id,round)
    );
    CREATE TABLE plan_review_remarks (
      id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES plan_reviews(id) ON DELETE CASCADE,
      steps TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(steps)),
      kind TEXT NOT NULL CHECK(kind IN ('contradiction','order','coverage','extra','unclear','risk')),
      text TEXT NOT NULL, suggestion TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','discussing','rejected','sent','applied','answered')),
      decision TEXT NOT NULL DEFAULT '', sent_status TEXT CHECK(sent_status IN ('accepted','discussing')),
      planner_session_id TEXT, outdated INTEGER NOT NULL DEFAULT 0 CHECK(outdated IN (0,1)), applied_version INTEGER, original TEXT CHECK(original IS NULL OR json_valid(original)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    CREATE TABLE plan_review_messages (
      id TEXT PRIMARY KEY, remark_id TEXT NOT NULL REFERENCES plan_review_remarks(id) ON DELETE CASCADE,
      author TEXT NOT NULL CHECK(author IN ('developer','reviewer','planner')),
      text TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0 CHECK(sent IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    PRAGMA foreign_keys = ON;
    INSERT INTO projects(id,name,repo_path) VALUES ('p','Project','/unused');
    INSERT INTO tasks(id,project_id,key) VALUES ('t','p','TASK');
    INSERT INTO plans(id,task_id,content) VALUES ('pl','t','- [ ] (p1) One');
    INSERT INTO plan_reviews(id,task_id,plan_version,plan_content,round) VALUES ('r1','t',1,'- [ ] (p1) One',1);
    INSERT INTO plan_review_remarks(id,review_id,steps,kind,text) VALUES ('c1','r1','[{"id":"p1","deleted":false}]','order','Old card');
    INSERT INTO plan_review_messages(id,remark_id,author,text) VALUES ('m1','c1','developer','Old comment');
  `);
  migrate(db);
  migrate(db);
  const { createPlanReviewService } = await import('../../../core-services').then(() => import('../../../core/review/plan/index'));
  const service = createPlanReviewService((await import('../../../infrastructure/db/repositories/review/plan/service-repository')).createPlanReviewRepository(db));
  const old = service.detail('p', 't', 'r1');
  assert.equal(old.review.target, 'plan');
  assert.equal(old.remarks[0].text, 'Old card');
  assert.equal(old.remarks[0].quote, '');
  assert.equal(old.remarks[0].messages[0].text, 'Old comment');
  db.prepare('INSERT INTO materials(id,task_id,type,content,version,author) VALUES (?,?,?,?,?,?)').run('m', 't', 'qa', '**Q1** One', 1, 'developer');
  const created = service.create('p', 't', { target: 'qa' });
  assert.equal(created.review.round, 1);
  assert.equal(service.create('p', 't').review.round, 2);
  service.addRemark('p', 't', created.review.id, { steps: ['Q1'], kind: 'suggestion', text: 'New kind' });
  db.prepare("DELETE FROM tasks WHERE id='t'").run();
  assert.equal((db.prepare('SELECT count(*) AS n FROM plan_review_remarks').get() as { n: number }).n, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});
