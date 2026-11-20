import '../../core-services';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { agentsRouter } from '../../api/http/routes/agents';
import { createAgent, getAgent, listAgents } from '../../core/agents/catalog';
import { createSession, getSession, history, initSessions } from '../../core/agents/sessions/sessions';
import { answerPermission, sendPrompt, shutdownSessions, snapshot, startSession, switchAgent } from '../../core/agents/sessions/acp-host';
import { closeDb, DATA_DIR, getDb } from '../../infrastructure/db/schema';
import { createProject } from '../../core/projects';

test('deletion refuses active work, closes idle sessions and preserves chats for another agent', async t => {
  initSessions();
  t.after(async () => { await shutdownSessions(); closeDb(); });
  const folder = path.join(DATA_DIR, 'deletion-project');
  fs.mkdirSync(folder, { recursive: true });
  const agent = createAgent({ name: 'Deletable mock', command: process.execPath,
    acp_command: process.execPath, acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs')] });
  const project = createProject({ name: 'Deletion', repo_path: folder, default_agent_id: agent.id });
  const idle = createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  const active = createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  await startSession(idle.id);
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/agents/${agent.id}`;
  const turn = sendPrompt(active.id, [{ type: 'text', text: 'permission' }]).catch(error => error);
  const deadline = Date.now() + 10_000;
  while (!snapshot(active.id).permissions.length) {
    assert.ok(Date.now() < deadline, 'agent must reach a permission request');
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  assert.equal((await fetch(url, { method: 'DELETE' })).status, 409);
  assert.ok(getAgent(agent.id));
  assert.ok(snapshot(idle.id).streaming, 'a refused deletion must leave idle siblings running');
  assert.equal(snapshot(active.id).permissions.length, 1);
  answerPermission(active.id, snapshot(active.id).permissions[0].permissionId, 'yes');
  assert.equal(await turn, undefined);
  const completedDeadline = Date.now() + 10_000;
  while (getSession(active.id).status !== 'ready') {
    assert.ok(Date.now() < completedDeadline, 'agent must finish its turn');
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  assert.equal((await fetch(url, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 404);
  assert.ok(!listAgents().some(item => item.id === agent.id));
  assert.equal(snapshot(idle.id).streaming, null);
  assert.equal(snapshot(active.id).streaming, null);
  assert.equal(getSession(active.id).metadata.deletedAgentName, agent.name);
  const saved = history(active.id);
  assert.ok(saved.some(event => event.type === 'assistant'));
  await assert.rejects(startSession(active.id), /Выберите другого агента/);
  assert.throws(() => createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' }), /Выберите другого агента/);

  const replacement = createAgent({ ...agent });
  await switchAgent(active.id, replacement.id);
  assert.equal(getSession(active.id).agent_id, replacement.id);
  assert.equal(getSession(active.id).metadata.deletedAgentName, undefined);
  assert.equal(getSession(active.id).metadata.needsContext, true);
  assert.deepEqual(history(active.id).slice(0, saved.length), saved);
  await startSession(active.id);
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);
});
