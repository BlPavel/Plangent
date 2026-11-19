import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { getDb, closeDb } from '../../infrastructure/db/schema';
import { configureSecretVault, InMemoryVault } from '../../infrastructure/secrets';
import { settingsRouter } from '../../api/http/routes/settings';
import { agentProxySettings, saveAgentProxy, shutdownAgentProxy } from '../../core/settings';
import { resolvedAgentEnv } from '../../core/agents/sessions/env';
import { createAgent, getAgent, updateAgent } from '../../infrastructure/db/repositories/agents/catalog';
import { addAgentProxy } from '../../infrastructure/db/migrations/016-agent-proxy';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../infrastructure/db/schema';

test('proxy settings encrypt credentials, keep API responses private, validate origins and block missing configurations', async t => {
  configureSecretVault(new InMemoryVault());
  t.after(async () => { await shutdownAgentProxy(); closeDb(); });
  assert.deepEqual(agentProxySettings(), { url: '', username: '', hasPassword: false });
  await assert.rejects(resolvedAgentEnv({ use_proxy: true, env: {} }), /прокси/i);
  const parentProxy = process.env.HTTPS_PROXY;
  const saved = saveAgentProxy({ url: 'socks5://employee:private%40password@proxy.company:1080' });
  assert.deepEqual(saved, { url: 'socks5://proxy.company:1080', username: 'employee', hasPassword: true });
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key='agent-proxy'").get() as { value: string };
  assert.ok(!row.value.includes('private@password')); assert.ok(!row.value.includes('private%40password'));
  const selected = await resolvedAgentEnv({ use_proxy: true, env: { https_proxy: 'http://wrong', NO_PROXY: '*' } }, { HTTPS_PROXY: 'http://project' });
  assert.match(selected.HTTPS_PROXY!, /^http:\/\/plangent:[a-f0-9]+@127\.0\.0\.1:\d+$/);
  assert.equal(selected.HTTPS_PROXY, selected.https_proxy);
  assert.ok(!JSON.stringify(selected).includes('private@password'));
  assert.equal(selected.NO_PROXY, '127.0.0.1,localhost,::1');
  assert.equal(process.env.HTTPS_PROXY, parentProxy, 'the command environment is not changed');
  const unselected = await resolvedAgentEnv({ use_proxy: false, env: { HTTPS_PROXY: 'http://own' } });
  assert.equal(unselected.HTTPS_PROXY, 'http://own');
  const local = selected.HTTPS_PROXY;
  assert.equal(saveAgentProxy({ url: saved.url, username: saved.username }).hasPassword, true);
  assert.equal((await resolvedAgentEnv({ use_proxy: true, env: {} })).HTTPS_PROXY, local, 'gateway address stays stable across updates');
  assert.equal(saveAgentProxy({ url: 'https://another.company:443', username: saved.username }).hasPassword, false, 'credentials do not carry over to a different server');
  for (const url of ['file:///etc/passwd', 'socks4://host:1080', 'http://host/path', 'http://host/?token=secret', 'invalid', 'http://host:99999'])
    assert.throws(() => saveAgentProxy({ url }));
  assert.throws(() => saveAgentProxy({ url: 'http://host', username: 'user\r\nInjected' }));
  saveAgentProxy({ url: 'http://proxy.company:8080', username: 'employee', password: 'api-private-password' });
  const app = express(); app.use(express.json()); app.use('/api/settings', settingsRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/settings/agent-proxy';
  const response = await fetch(base); const text = await response.text();
  assert.equal(response.status, 200); assert.ok(!text.includes('api-private-password')); assert.ok(!text.includes('secret'));
  assert.equal((await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ url: '' }) })).status, 403);
  assert.equal(agentProxySettings().hasPassword, true);
  assert.equal((await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://proxy.company:8080', username: 'employee', password: '' }) })).status, 200);
  assert.equal(agentProxySettings().hasPassword, false);
  const agent = createAgent({ name: 'Proxy test' });
  assert.equal(agent.use_proxy, false);
  updateAgent(agent.id, { use_proxy: true });
  assert.equal(getAgent(agent.id)!.use_proxy, true);
  addAgentProxy(getDb()); // Migration is repeatable and retains the choice.
  assert.equal(getAgent(agent.id)!.use_proxy, true);
  saveAgentProxy({ url: '' });
  await assert.rejects(resolvedAgentEnv({ use_proxy: true, env: {} }), /прокси/i);
});

test('missing proxy records a session error and route changes hold off new launches until saved', async t => {
  await import('../../core-services');
  const host = await import('../../core/agents/sessions/acp-host');
  const sessions = await import('../../core/agents/sessions/sessions');
  sessions.initSessions();
  const { createProject } = await import('../../core/projects');
  t.after(async () => { await host.shutdownSessions(); await shutdownAgentProxy(); closeDb(); });
  const folder = path.join(DATA_DIR, 'proxy-session-project'); fs.mkdirSync(folder, { recursive: true });
  const project = createProject({ name: 'Proxy session', repo_path: folder });
  const agent = createAgent({ name: 'Proxy session agent', use_proxy: true, command: process.execPath,
    acp_command: process.execPath, acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs')] });
  const session = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'chat', policy: 'ask' });
  saveAgentProxy({ url: '' });
  await assert.rejects(host.startSession(session.id), /прокси/i);
  assert.equal(sessions.getSession(session.id).status, 'error');
  const release = await host.prepareAgentProxyChange(agent.id);
  try {
    await assert.rejects(host.startSession(session.id), /изменяются/i);
    updateAgent(agent.id, { use_proxy: false });
  } finally { release(); }
  await host.startSession(session.id);
  assert.equal(sessions.getSession(session.id).status, 'ready');
});
