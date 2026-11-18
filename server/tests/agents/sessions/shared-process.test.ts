import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHAT_IDLE_MS } from '../../../core/agents/sessions/idle-policy';

test('shared chat lifecycle isolates permissions, idle release, close during a turn and restoration', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-shared-'));
  process.env.PLANGENT_DATA_DIR = root;
  // Resolve a pinned adapter to an isolated mock install without npm/network/accounts.
  const pkg = path.join(root, 'adapters', '@agentclientprotocol+codex-acp@2.7.0', 'node_modules', '@agentclientprotocol', 'codex-acp');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ bin: 'index.cjs' }));
  fs.writeFileSync(path.join(pkg, 'index.cjs'), `import(${JSON.stringify(pathToFileURL(path.resolve('server/tests/support/mock-shared-acp-agent.mjs')).href)});`);
  const api = await import('../../../core-services').then(() => import('../../../core/agents'));
  const host = await import('../../../core/agents/sessions/acp-host');
  const { getDb } = await import('../../../infrastructure/db/schema');
  const { createProject } = await import('../../../core/projects');
  const { killProcessTree } = await import('../../../infrastructure/terminal/process-tree');
  api.initSessions();
  host.configureSessionHost({ mcp: session => [{ type: 'http', name: 'plangent', url: 'http://localhost/mcp',
    headers: [{ name: 'Authorization', value: session.id }] }], terminate: killProcessTree });
  const agent = api.createAgent({ name: 'Shared mock', command: 'codex', acp_command: 'npx',
    acp_args: ['--yes', '@agentclientprotocol/codex-acp@2.7.0'] });
  const project = createProject({ name: 'Shared', repo_path: root });
  const first = api.createAgentSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  const second = api.createAgentSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  async function until(check: () => boolean) {
    const end = Date.now() + 10_000;
    while (!check()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  const text = (id: string) => api.history(id).filter(e => e.type === 'assistant').map(e => String(e.payload.text)).join('');
  try {
    const [a, b] = await Promise.all([host.startSession(first.id), host.startSession(second.id)]);
    assert.equal(a.process.pid, b.process.pid);
    await Promise.all([host.sendPrompt(first.id, [{ type: 'text', text: 'permission' }]), host.sendPrompt(second.id, [{ type: 'text', text: 'permission' }])]);
    await until(() => host.snapshot(first.id).permissions.length === 1 && host.snapshot(second.id).permissions.length === 1);
    host.answerPermission(first.id, host.snapshot(first.id).permissions[0].permissionId, 'yes');
    await until(() => api.getSession(first.id).status === 'ready');
    assert.equal(host.snapshot(second.id).permissions.length, 1);
    assert.ok(text(first.id).includes(first.id));
    assert.ok(!text(first.id).includes(second.id), 'MCP configuration stays with its own chat');
    host.stopIdleSessions(Date.now() + CHAT_IDLE_MS + 100);
    assert.equal(host.snapshot(first.id).streaming, null);
    assert.notEqual(host.snapshot(second.id).streaming, null, 'pending permission keeps sibling alive');
    const resumed = await host.startSession(first.id);
    assert.equal(resumed.process.pid, b.process.pid);
    host.answerPermission(second.id, host.snapshot(second.id).permissions[0].permissionId, 'no');
    await until(() => api.getSession(second.id).status === 'ready');
    await host.sendPrompt(first.id, [{ type: 'text', text: 'hold' }]);
    await host.closeSession(first.id);
    assert.equal(host.snapshot(first.id).streaming, null);
    await host.sendPrompt(second.id, [{ type: 'text', text: 'survived' }]);
    await until(() => api.getSession(second.id).status === 'ready');
    assert.match(text(second.id), /survived/);
    await host.closeSession(second.id);
    assert.notEqual(b.process.exitCode, null);
    const restarted = await host.startSession(first.id);
    assert.notEqual(restarted.process.pid, b.process.pid);
    await host.sendPrompt(first.id, [{ type: 'text', text: 'continued' }]);
    await until(() => api.getSession(first.id).status === 'ready');
    assert.match(text(first.id), /continued/);
    const sibling = await host.startSession(second.id);
    assert.equal(sibling.process.pid, restarted.process.pid);
    await host.sendPrompt(first.id, [{ type: 'text', text: 'permission' }]);
    await until(() => host.snapshot(first.id).permissions.length === 1);
    await host.sendPrompt(second.id, [{ type: 'text', text: 'crash' }]);
    await until(() => api.getSession(first.id).status === 'error' && api.getSession(second.id).status === 'error');
    assert.equal(host.snapshot(first.id).permissions.length, 0, 'process failure resolves outstanding permissions');
    assert.equal(host.snapshot(second.id).streaming, null);
    const recovered = await host.startSession(first.id);
    assert.notEqual(recovered.process.pid, restarted.process.pid);
    await host.sendPrompt(first.id, [{ type: 'text', text: 'after crash' }]);
    await until(() => api.getSession(first.id).status === 'ready');
    assert.match(text(first.id), /after crash/);
  } finally {
    await host.shutdownSessions();
    getDb().close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
