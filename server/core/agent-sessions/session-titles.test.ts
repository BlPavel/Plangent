import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once, EventEmitter } from 'node:events';
import express from 'express';
import type { WebSocket } from 'ws';

test('ACP titles persist and broadcast without splitting replies, including resume and manual rename', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-chat-titles-'));
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const sessions = await import('./sessions');
  const host = await import('./acp-host');
  const { createAgent } = await import('../agents');
  const { createProject } = await import('../projects');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  const { agentSessionsRouter } = await import('../../infrastructure/http/routes/agent-sessions');
  const { addEventsClient } = await import('../shared/events');
  sessions.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const events: Record<string, any>[] = [];
  const ws = Object.assign(new EventEmitter(), { readyState: 1, send: (data: string) => events.push(JSON.parse(data)) });
  addEventsClient(ws as unknown as WebSocket);
  const agent = createAgent({ name: 'Mock titles', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('scripts/mock-acp-agent.mjs'), '--session-titles'] });
  const project = createProject({ name: 'circle', repo_path: root });
  const sourcePath = path.join(root, 'mtsip');
  fs.mkdirSync(sourcePath);
  createProject({ kind: 'source', name: 'mtsip', repo_path: sourcePath });
  const otherSourcePath = path.join(root, 'api-archive');
  fs.mkdirSync(otherSourcePath);
  createProject({ kind: 'source', name: 'Архив API (v2)', key: 'api-archive', repo_path: otherSourcePath });
  const chat = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  const app = express();
  app.use(express.json());
  app.use('/sessions', agentSessionsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const done = once(host.sessionSignals, 'turn_end');
    await host.sendPrompt(chat.id, [{ type: 'text', text: 'Help me name this conversation' }]);
    await done;
    assert.equal(sessions.getSession(chat.id).title, 'Meaningful chat title');
    assert.ok(events.some(e => e.type === 'agent_session' && e.session.id === chat.id && e.session.title === 'Meaningful chat title'));
    assert.ok(!events.some(e => e.type === 'agent_session' && e.session.id === chat.id && /^do not commit/i.test(e.session.title)),
      'The provisional title from hidden instructions must never reach the UI');
    assert.deepEqual(sessions.history(chat.id).filter(e => e.type === 'assistant').map(e => e.payload.text), ['hello world']);
    assert.ok(!sessions.history(chat.id).some(e => e.type === 'session_info_update'));

    await host.closeSession(chat.id);
    await host.startSession(chat.id);
    assert.equal(sessions.getSession(chat.id).title, 'Restored chat title');

    const response = await fetch(base + '/sessions/' + chat.id, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'My own title' }) });
    assert.equal(response.status, 200);
    assert.equal(sessions.getSession(chat.id).metadata.titleSource, 'manual');
    const renamedDone = once(host.sessionSignals, 'turn_end');
    await host.sendPrompt(chat.id, [{ type: 'text', text: 'Continue' }]);
    await renamedDone;
    assert.equal(sessions.getSession(chat.id).title, 'My own title');
    await host.closeSession(chat.id);
    await host.startSession(chat.id);
    assert.equal(sessions.getSession(chat.id).title, 'My own title');

    for (const title of [undefined, null, '', '   ']) sessions.updateAgentTitle(chat.id, title);
    assert.equal(sessions.getSession(chat.id).title, 'My own title');

    const plain = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask',
      metadata: { keep: true } });
    for (const title of [undefined, null, '', '   ', 'Do not commit or run git commands that modify the repository.',
      '  DO NOT COMMIT or run git commands  ']) sessions.updateAgentTitle(plain.id, title);
    assert.equal(sessions.getSession(plain.id).title, plain.title);
    sessions.updateAgentTitle(plain.id, 'A'.repeat(150));
    assert.equal(sessions.getSession(plain.id).title.length, 120);
    assert.equal(sessions.getSession(plain.id).metadata.keep, true);

    sessions.addEvent(plain.id, 'user', { text: 'Что думаешь об этом проекте?', content: [{ type: 'text', text: 'Что думаешь об этом проекте?' }] });
    sessions.updateAgentTitle(plain.id, 'Мнение о проекте mtsip');
    assert.equal(sessions.getSession(plain.id).title, 'Мнение о проекте mtsip', 'ACP titles must not be replaced based on reference names');
    for (const title of ['Обзор api-archive', 'Мнение: Архив API (v2)']) {
      sessions.updateAgentTitle(plain.id, title);
      assert.equal(sessions.getSession(plain.id).title, title);
    }
    sessions.updateSession(plain.id, { title: 'Мнение о проекте mtsip' });
    assert.equal(sessions.getSession(plain.id).title, 'Мнение о проекте mtsip');
    assert.equal(sessions.listSessions(project.id).find(s => s.id === plain.id)!.title, 'Мнение о проекте mtsip');

    for (const options of [{ title: 'Explicit title' }, { role: 'librarian' as const }, { metadata: { mr_private: true } }]) {
      const fixed = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask', ...options });
      sessions.updateAgentTitle(fixed.id, 'Agent replacement');
      assert.equal(sessions.getSession(fixed.id).title, fixed.title);
    }
  } finally {
    await host.closeSession(chat.id);
    ws.emit('close');
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
  }
});
