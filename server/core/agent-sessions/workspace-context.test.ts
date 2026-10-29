import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';

test('ACP supplies reference sources only on explicit mention, with no discovery tool or legacy visibility', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-workspace-context-'));
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const sessions = await import('./sessions');
  const host = await import('./acp-host');
  const { createAgent } = await import('../agents');
  const { createProject } = await import('../projects');
  const { createTask } = await import('../tasks');
  const { initQueues } = await import('../orchestration/queue');
  const { stopWatchAnalysis } = await import('../orchestration/task-files');
  const { WORKSPACE_BRIEFING_VERSION } = await import('../projects/workspace');
  const { mcpRouter, sessionMcpConfig, allowed } = await import('../../infrastructure/mcp/server');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  sessions.initSessions();
  initQueues();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const circlePath = path.join(root, 'circle');
  const mtsipPath = path.join(root, 'mtsip');
  fs.mkdirSync(circlePath);
  fs.mkdirSync(mtsipPath);
  const project = createProject({ name: 'circle', repo_path: circlePath });
  const source = createProject({ kind: 'source', name: 'mtsip', repo_path: mtsipPath });
  getDb().prepare('UPDATE projects SET config=? WHERE id=?').run(JSON.stringify({ available_everywhere: true }), source.id);
  getDb().prepare('INSERT INTO source_targets (source_id,target_id) VALUES (?,?)').run(source.id, project.id);
  const hiddenPath = path.join(root, 'private-docs');
  fs.mkdirSync(hiddenPath);
  createProject({ kind: 'source', name: 'Private docs', key: 'private-docs', repo_path: hiddenPath });
  const agent = createAgent({ name: 'Workspace inspector', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('scripts/mock-acp-agent.mjs'), '--inspect-workspace'] });
  const chat = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  const activeSessions = [chat.id];
  const taskIds: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const config = sessionMcpConfig(chat, true)[0] as { headers: { name: string; value: string }[] };
  const call = async (method: string, params = {}) => {
    const response = await fetch(base + '/mcp', { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...Object.fromEntries(config.headers.map(h => [h.name, h.value])),
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ error?: unknown; result?: { content: { text: string }[]; tools: { name: string; description: string }[] } }>;
  };
  const question = 'на чем построено это приложение?';
  async function ask(text = question, sessionId = chat.id) {
    const done = once(host.sessionSignals, 'turn_end');
    await host.sendPrompt(sessionId, [{ type: 'text', text }]);
    await done;
    const reply = sessions.history(sessionId).filter(e => e.type === 'assistant').at(-1)!;
    return JSON.parse(String(reply.payload.text)) as { cwd: string; prompt: { type: string; text: string }[] };
  }
  function checkWorkspace(result: Awaited<ReturnType<typeof ask>>) {
    assert.equal(result.cwd, circlePath);
    const briefing = result.prompt[0].text;
    assert.ok(briefing.includes(`Active project: "circle" (@circle). Working directory: ${circlePath}`));
    assert.ok(!JSON.stringify(result.prompt).includes('mtsip'));
    assert.ok(!JSON.stringify(result.prompt).includes('private-docs'));
    assert.ok(!briefing.includes('get_references'));
    assert.ok(briefing.includes('only when the developer explicitly mentions'));
    assert.deepEqual(result.prompt.at(-1), { type: 'text', text: question });
  }
  try {
    checkWorkspace(await ask());
    assert.equal(sessions.getSession(chat.id).metadata.workspaceBriefingVersion, WORKSPACE_BRIEFING_VERSION);
    assert.equal(sessions.history(chat.id).find(e => e.type === 'user')!.payload.text, question);

    // Once received, the briefing is not repeated on every turn.
    assert.deepEqual((await ask()).prompt, [{ type: 'text', text: question }]);

    const fileMention = await ask('Посмотри @private-docs/README.md');
    assert.ok(fileMention.prompt[0].text.includes(hiddenPath));
    assert.ok(!JSON.stringify(fileMention.prompt).includes(mtsipPath));

    // Task agents also omit sources by default and resolve manually referenced task descriptions.
    const task = createTask({ project_id: project.id, key: 'MANUAL-REF', description: 'Сравни с @mtsip' });
    const { insertWorkspace, updateWorkspace } = await import('../workspaces/store');
    const taskRoot = path.join(root, 'task-workspace');
    fs.mkdirSync(taskRoot);
    const taskWorkspace = insertWorkspace({ project_id: project.id, task_id: task.id, branch: 'task-branch', base_branch: 'main', path: taskRoot });
    updateWorkspace(taskWorkspace.id, { status: 'ready' });
    taskIds.push(task.id);
    const executor = sessions.createSession({ project_id: project.id, task_id: task.id, agent_id: agent.id, role: 'executor', policy: 'ask' });
    activeSessions.push(executor.id);
    const execution = await ask('Начинай', executor.id);
    assert.equal(execution.cwd, taskRoot);
    assert.ok(execution.prompt[0].text.includes('Working directory: ' + taskRoot));
    assert.ok(execution.prompt.some(block => block.text.includes(mtsipPath)));
    assert.ok(!JSON.stringify(execution.prompt).includes(hiddenPath));

    const analyst = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'analyst', policy: 'read-only' });
    activeSessions.push(analyst.id);
    checkWorkspace(await ask(question, analyst.id));

    // Existing conversations retain briefed=true from the old implementation.
    sessions.updateSession(chat.id, { metadata: { ...sessions.getSession(chat.id).metadata, workspaceBriefingVersion: 1 } });
    await host.closeSession(chat.id);
    checkWorkspace(await ask());
    assert.equal(sessions.getSession(chat.id).metadata.workspaceBriefingVersion, WORKSPACE_BRIEFING_VERSION);

    // The agent cannot discover a source catalog on its own.
    const listed = (await call('tools/list')).result!.tools;
    assert.deepEqual(listed, []);
    assert.ok(!JSON.stringify(listed).includes('mtsip'));
    assert.deepEqual(allowed({ ...sessions.getSession(chat.id), metadata: { mr_private: true } }), []);
    sessions.updateSession(chat.id, { status: 'thinking' });
    const denied = await call('tools/call', { name: 'get_references', arguments: {} });
    assert.ok(denied.error);
    sessions.updateSession(chat.id, { status: 'ready' });

    const mentioned = await ask('Сравни этот проект с @mtsip');
    assert.equal(mentioned.cwd, circlePath);
    assert.ok(mentioned.prompt[0].text.includes(mtsipPath));
    assert.ok(!JSON.stringify(mentioned.prompt).includes(hiddenPath));
    assert.equal(mentioned.prompt.at(-1)!.text, 'Сравни этот проект с @mtsip');
    assert.deepEqual((await ask()).prompt, [{ type: 'text', text: question }]);
  } finally {
    for (const sessionId of activeSessions) await host.closeSession(sessionId);
    for (const taskId of taskIds) stopWatchAnalysis(taskId);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
  }
});
