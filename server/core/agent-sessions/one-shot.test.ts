import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('commit generation stays separate from user chats', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-one-shot-'));
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const sessions = await import('./sessions');
  const host = await import('./acp-host');
  const { oneShot } = await import('./one-shot');
  const { createAgent } = await import('../agents');
  const { createProject } = await import('../projects');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  sessions.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('scripts/mock-acp-agent.mjs')] });
  const project = createProject({ name: 'Test', repo_path: root });
  const chat = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  sessions.addEvent(chat.id, 'user', { text: 'My chat message' });
  try {
    assert.equal(await oneShot(project.id, { agentId: agent.id }, 'Write a commit message'), 'hello world');
    const all = sessions.listSessions(project.id);
    assert.deepEqual(all.filter(s => s.role === 'chat').map(s => s.id), [chat.id]);
    const generated = all.find(s => s.id !== chat.id)!;
    assert.equal(generated.role, 'committer');
    assert.equal(generated.policy, 'read-only');
    assert.equal(generated.status, 'complete');
    assert.deepEqual(sessions.history(chat.id).map(e => e.payload.text), ['My chat message']);
    assert.ok(sessions.history(generated.id).some(e => e.type === 'assistant'));
  } finally {
    await host.shutdownSessions();
    getDb().close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});