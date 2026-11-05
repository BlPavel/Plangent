import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('material author MCP: own type only, ready architecture for QA, stale saves rejected, briefing is a pointer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-material-author-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { initializeAgentPresets } = await import('../../../core-services').then(() => import('../../../core/agents/catalog/seed'));
  initializeAgentPresets();
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { createTask } = await import('../../../core-services').then(() => import('../../../core/tasks'));
  const { initQueues } = await import('../../../core-services').then(() => import('../../../core/execution/queue'));
  const { initSessions, createSession, updateSession } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const { createPlan } = await import('../../../core-services').then(() => import('../../../core/preparation/plans'));
  const { buildPrompt } = await import('../../../core-services').then(() => import('../../../core/preparation/prompts'));
  const { mcpRouter, sessionMcpConfig, allowed } = await import('../../../core-services').then(() => import('../../../api/mcp/server'));
  const materials = await import('../../../core-services').then(() => import('../../../core/preparation/materials/index'));
  const stages = await import('../../../core-services').then(() => import('../../../core/preparation/materials/stages'));
  initQueues(); initSessions();
  const project = createProject({ name: 'Authors', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'AUTH' });
  createPlan({ task_id: task.id, content: '- [ ] PLAN SECRET' });
  const session = (type: 'architecture' | 'qa') => {
    const created = createSession({ project_id: project.id, task_id: task.id, agent_id: 'agent-codex', role: 'material-author', policy: 'read-only', metadata: { material_type: type } });
    return updateSession(created.id, { status: 'thinking' });
  };
  const architect = session('architecture'), qa = session('qa');
  const app = express(); app.use(express.json()); app.use('/mcp', mcpRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const previousUrl = process.env.PLANGENT_URL;
  process.env.PLANGENT_URL = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const clients: Client[] = [];
  async function connect(s: typeof architect) {
    const config = sessionMcpConfig(s, true)[0] as { url: string; headers: { name: string; value: string }[] };
    const client = new Client({ name: 'test', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: Object.fromEntries(config.headers.map(h => [h.name, h.value])) } }));
    clients.push(client); return client;
  }
  const value = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text);
  try {
    const arch = await connect(architect), qaClient = await connect(qa);
    assert.deepEqual((await arch.listTools()).tools.map(t => t.name), ['get_interview_guide', 'get_material', 'submit_material', 'get_plan_review_items', 'reply_plan_remark']);
    assert.ok(!allowed(architect).some(name => ['submit_plan', 'save_section', 'complete_step'].includes(name)));
    await assert.rejects(arch.callTool({ name: 'mark_stage', arguments: {} }));

    // The architecture author sees neither QA nor the plan.
    const before = value(await arch.callTool({ name: 'get_material', arguments: {} }));
    assert.equal(before.material, 'architecture');
    assert.equal(before.current.version, 0);
    assert.ok(!('architecture' in before) && !JSON.stringify(before).includes('PLAN SECRET'));
    assert.match(before.template, /Context and boundaries/);
    assert.match(before.format, /submit_material/);
    await assert.rejects(arch.callTool({ name: 'submit_material', arguments: { content: '' } }), /Invalid content/);

    const saved = value(await arch.callTool({ name: 'submit_material', arguments: { content: '**D1** Boundary' } }));
    assert.deepEqual([saved.version, saved.identifiers], [1, ['D1']]);
    assert.equal(materials.getLatestMaterial(task.id, 'architecture')!.author, 'agent');
    assert.equal(materials.getLatestMaterial(task.id, 'qa'), null);

    // A manual edit after get_material is never overwritten.
    value(await arch.callTool({ name: 'get_material', arguments: {} }));
    materials.saveMaterial({ task_id: task.id, type: 'architecture', content: 'manual', expected_version: 1 });
    const stale = await arch.callTool({ name: 'submit_material', arguments: { content: 'agent overwrite' } });
    assert.equal(stale.isError, true);
    assert.match(JSON.stringify(stale), /get_material/);
    assert.equal(materials.getLatestMaterial(task.id, 'architecture')!.content, 'manual');
    value(await arch.callTool({ name: 'get_material', arguments: {} }));
    assert.equal(value(await arch.callTool({ name: 'submit_material', arguments: { content: 'merged' } })).version, 3);

    // QA gets the architecture only when the developer marked it ready.
    const draft = value(await qaClient.callTool({ name: 'get_material', arguments: {} }));
    assert.equal(draft.architecture, null);
    assert.ok(draft.architectureNote);
    stages.markPreparationStage(task.id, 'architecture', 'ready');
    const ready = value(await qaClient.callTool({ name: 'get_material', arguments: {} }));
    assert.equal(ready.architecture.content, 'merged');
    assert.match(ready.template, /Q1/);
    assert.equal(value(await qaClient.callTool({ name: 'submit_material', arguments: { content: '**Q1** Rule' } })).version, 1);
    assert.equal(materials.getLatestMaterial(task.id, 'architecture')!.content, 'merged');
    assert.equal(stages.getPreparationStages(task.id).find(s => s.stage === 'qa')!.status, 'draft');

    // submit before get_material is refused.
    const fresh = await connect(session('qa'));
    assert.equal((await fresh.callTool({ name: 'submit_material', arguments: { content: 'x' } })).isError, true);

    // The briefing is only a pointer.
    for (const purpose of ['architecture', 'qa'] as const) {
      const prompt = buildPrompt({ projectName: project.name, taskKey: task.key, purpose, planContent: 'PLAN SECRET', taskDescription: 'DESC' });
      assert.match(prompt, /get_material/);
      assert.match(prompt, /submit_material/);
      assert.ok(!/PLAN SECRET|DESC|Context and boundaries|Plangent protocol/.test(prompt));
    }
  } finally {
    for (const client of clients) await client.close();
    server.close();
    if (previousUrl === undefined) delete process.env.PLANGENT_URL; else process.env.PLANGENT_URL = previousUrl;
    const { getDb } = await import('../../../infrastructure/db/schema');
    getDb().close();
  }
});
