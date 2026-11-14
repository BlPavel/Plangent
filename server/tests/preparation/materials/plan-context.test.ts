import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('planner and executors get ready architecture and QA through MCP, links are validated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-plan-context-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { initializeAgentPresets } = await import('../../../core-services').then(() => import('../../../core/agents/catalog/seed'));
  initializeAgentPresets();
  const { getDb } = await import('../../../infrastructure/db/schema');
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { createTask } = await import('../../../core-services').then(() => import('../../../core/tasks'));
  const { initQueues } = await import('../../../core-services').then(() => import('../../../core/execution/queue'));
  const { initSessions, createSession, updateSession } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const analysis = await import('../../../core-services').then(() => import('../../../core/preparation/analysis'));
  const { submitPlan, stopWatchPlanFile } = await import('../../../core-services').then(() => import('../../../core/preparation/plan-file'));
  const { getLatestPlan, createPlan } = await import('../../../core-services').then(() => import('../../../core/preparation/plans'));
  const { stopWatchAnalysis } = await import('../../../core-services').then(() => import('../../../core/tasks/task-files'));
  const { buildPrompt, planningToolContext } = await import('../../../core-services').then(() => import('../../../core/preparation/prompts'));
  const { mcpRouter, sessionMcpConfig } = await import('../../../core-services').then(() => import('../../../api/mcp/server'));
  const { PLAN_PROTOCOL_LOCKED } = await import('../../../core-services').then(() => import('../../../core/library/plan-template'));
  const materials = await import('../../../core-services').then(() => import('../../../core/preparation/materials/index'));
  const stages = await import('../../../core-services').then(() => import('../../../core/preparation/materials/stages'));
  initQueues(); initSessions();
  const project = createProject({ name: 'Plan context', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'CTX' });
  const legacy = createTask({ project_id: project.id, key: 'LEGACY' });
  const section = analysis.createAnalysisSection({ task_id: task.id, title: 'QA', description: 'ANALYSIS TEXT', kind: 'worked' });
  assert.notEqual(section.slug, 'qa');
  materials.saveMaterial({ task_id: task.id, type: 'architecture', content: '**D1** Boundary\n**D2** Storage' });
  materials.saveMaterial({ task_id: task.id, type: 'qa', content: '**Q1** One\n**Q3** Three' });
  const planner = updateSession(createSession({ project_id: project.id, task_id: task.id, agent_id: 'agent-codex', role: 'planner', policy: 'read-only' }).id, { status: 'thinking' });
  const app = express(); app.use(express.json()); app.use('/mcp', mcpRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const previousUrl = process.env.PLANGENT_URL;
  process.env.PLANGENT_URL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const clients: Client[] = [];
  async function connect(s: typeof planner) {
    const config = sessionMcpConfig(s, true)[0] as { url: string; headers: { name: string; value: string }[] };
    const client = new Client({ name: 'test', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: Object.fromEntries(config.headers.map(h => [h.name, h.value])) } }));
    clients.push(client); return client;
  }
  const value = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text);
  const executorOf = (stepIds: string[], policy: 'allow-all' | 'read-only' = 'allow-all') => updateSession(createSession({
    project_id: project.id, task_id: task.id, agent_id: 'agent-codex', role: 'executor', policy, step_ids: stepIds }).id, { status: 'thinking' });
  const kind = (type: string) => (m: { type: string }) => m.type === type;
  try {
    assert.match(PLAN_PROTOCOL_LOCKED, /\[\[qa#Q3\]\]/);
    const planning = await connect(planner)
    // Drafts are not a ground for the plan; the planner is told they exist.
    const draft = value(await planning.callTool({ name: 'get_plan', arguments: {} }));
    assert.equal(draft.architecture, null); assert.equal(draft.qa, null);
    assert.match(JSON.stringify(draft.materialsNotUsed), /qa: not marked ready/);
    assert.throws(() => submitPlan(task, root, '- [ ] Step [[qa#Q3]]', true), /not marked ready/);
    assert.equal((await planning.callTool({ name: 'submit_plan', arguments: { content: '- [ ] Step [[architecture]]' } })).isError, true);

    stages.markPreparationStage(task.id, 'architecture', 'ready')
    stages.markPreparationStage(task.id, 'qa', 'ready');
    const ready = value(await planning.callTool({ name: 'get_plan', arguments: {} }));
    assert.deepEqual(ready.qa.identifiers, ['Q1', 'Q3']);
    assert.match(ready.architecture.content, /Storage/);
    assert.equal(ready.materialsNotUsed, undefined);
    assert.equal(planningToolContext({ projectName: 'p', taskKey: 'k', }).qa, undefined);

    const missing = await planning.callTool({ name: 'submit_plan', arguments: { content: '- [ ] Step [[qa#Q9]]' } });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing), /Q1, Q3/);
    const saved = value(await planning.callTool({ name: 'submit_plan', arguments: { content: [
      '- [ ] Storage [[architecture#D2]] [[qa#Q1]] [[qa#Q3]]', '- [ ] Whole QA [[qa]] and analysis [[' + section.slug + ']]', '- [ ] Plain'].join('\n') } }));
    assert.equal(saved.steps.length, 3);
    stopWatchPlanFile(task.id);

    const first = value(await (await connect(executorOf(['p1']))).callTool({ name: 'get_step_context', arguments: {} }));
    assert.deepEqual(first.steps.map((s: { id: string }) => s.id), ['p1']);
    const qa = first.materials.find(kind('qa'));
    assert.deepEqual(qa.referenced, ['Q1', 'Q3']);
    assert.match(qa.content, /Three/);
    assert.deepEqual(qa.stepsPerIdentifier.Q1.map((s: { id: string }) => s.id), ['p1']);
    assert.deepEqual(first.materials.find(kind('architecture')).referenced, ['D2']);
    assert.deepEqual(first.analysis, []);
    // The second step links to the whole QA and the analysis section.
    const whole = value(await (await connect(executorOf(['p2']))).callTool({ name: 'get_step_context', arguments: {} }));
    assert.equal(whole.materials.find(kind('qa')).referenced, 'all');
    assert.equal(whole.analysis[0].readme.description, 'ANALYSIS TEXT');
    assert.deepEqual(value(await (await connect(executorOf(['p3'], 'read-only'))).callTool({ name: 'get_step_context', arguments: {} })).materials, []);
    // Not an executor tool for other roles.
    await assert.rejects(planning.callTool({ name: 'get_step_context', arguments: {} }));

    // The prompt never carries material text.
    const prompt = buildPrompt({ projectName: project.name, taskKey: task.key, taskId: task.id, repoPath: root, planContent: getLatestPlan(task.id)!.content, points: ['p1'], purpose: 'execute', });
    assert.match(prompt, /get_step_context/);
    assert.ok(!/Boundary|Storage|Three|ANALYSIS TEXT/.test(prompt));
    // A skipped (not ready) QA becomes unavailable to executors.
    stages.markPreparationStage(task.id, 'qa', 'skipped');
    const after = value(await (await connect(executorOf(['p1']))).callTool({ name: 'get_step_context', arguments: {} }));
    assert.equal(after.materials.find(kind('qa')).available, false);
    assert.equal(after.materials.find(kind('qa')).content, undefined);

    // Existing tasks have analysis and a plan, but no explicit preparation marks.
    const oldSection = analysis.createAnalysisSection({ task_id: legacy.id, title: 'Old requirements', description: 'LEGACY ANALYSIS' });
    createPlan({ task_id: legacy.id, content: '- [ ] (p1) Existing step [[' + oldSection.slug + ']]' });
    assert.deepEqual(stages.getPreparationStages(legacy.id).map(s => s.status), ['draft', 'not_started', 'not_started', 'draft']);
    const oldExecutor = updateSession(createSession({ project_id: project.id, task_id: legacy.id,
      agent_id: 'agent-codex', role: 'executor', policy: 'allow-all', step_ids: ['p1'] }).id, { status: 'thinking' });
    const oldContext = value(await (await connect(oldExecutor)).callTool({ name: 'get_step_context', arguments: {} }));
    assert.equal(oldContext.analysis[0].readme.description, 'LEGACY ANALYSIS');
    assert.deepEqual(oldContext.materials, []);
  } finally {
    for (const client of clients) await client.close();
    for (const id of [task.id, legacy.id]) { stopWatchPlanFile(id); stopWatchAnalysis(id); }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previousUrl === undefined) delete process.env.PLANGENT_URL; else process.env.PLANGENT_URL = previousUrl;
    getDb().close();
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
