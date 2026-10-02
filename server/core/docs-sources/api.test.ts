
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-docs-api-'));
process.env.PLANGENT_DATA_DIR = root;

test('preset form login, docs API lifecycle, files, mentions, progress and cancellation', async t => {
  const { getDb } = await import('../../infrastructure/db/schema');
  const { configureSecretVault, InMemoryVault } = await import('../../infrastructure/secrets');
  const integrations = await import('../integrations');
  const { integrationPresets } = await import('../integrations/presets');
  const { docsSourcePresets } = await import('./presets');
  const { projectsRouter } = await import('../../infrastructure/http/routes/projects');
  const { integrationsRouter } = await import('../../infrastructure/http/routes/integrations');
  const { addEventsClient } = await import('../shared/events');
  const { isDocsSyncRunning, resetInterruptedDocsSyncs, sourceFolder } = await import('./index');
  configureSecretVault(new InMemoryVault());
  let logins = 0, slow = false;
  const remote = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://local');
    if (url.pathname === '/dologin.action') {
      logins++;
      let body = ''; for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      assert.equal(req.headers['x-atlassian-token'], 'no-check');
      if (form.get('os_username') !== 'reader' || form.get('os_password') !== 'fixture-password') {
        res.writeHead(200, { 'X-Seraph-LoginReason': 'AUTHENTICATED_FAILED' }); res.end('denied'); return;
      }
      res.writeHead(302, { 'Set-Cookie': 'session=fixture-cookie; Path=/; HttpOnly', Location: '/' }); res.end(); return;
    }
    if (req.headers.authorization) { res.writeHead(401); res.end(); return; }
    if (req.headers.cookie !== 'session=fixture-cookie') {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/rest/api/user/current' || url.pathname === '/') { res.end('{"displayName":"Reader"}'); return; }
    if (slow) await new Promise(resolve => setTimeout(resolve, 200));
    const id = url.pathname.split('/')[4];
    const node = (id: string) => ({ id, title: id === '1' ? 'Root' : 'Child', version: { number: 1 }, ancestors: id === '1' ? [] : [{ id: '1' }], body: { storage: { value: '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[const x = 1;]]></ac:plain-text-body></ac:structured-macro>' } } });
    if (url.pathname.endsWith('/child/page')) {
      res.end(JSON.stringify({ results: id === '1' && url.searchParams.get('start') === '0' ? [node('2')] : [] })); return;
    }
    res.end(JSON.stringify(node(id)));
  });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  const app = express(); app.use('/api/integrations', integrationsRouter); app.use(express.json()); app.use('/api/projects', projectsRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const wss = new WebSocketServer({ server }); wss.on('connection', addEventsClient);
  const port = (server.address() as { port: number }).port;
  const events: { type: string }[] = [];
  const ws = new WebSocket('ws://127.0.0.1:' + port); ws.on('message', data => events.push(JSON.parse(String(data)))); await once(ws, 'open');
  t.after(async () => {
    ws.close(); await once(ws, 'close'); wss.close();
    remote.closeAllConnections(); server.closeAllConnections();
    await Promise.all([new Promise<void>(r => remote.close(() => r())), new Promise<void>(r => server.close(() => r()))]);
    getDb().close(); fs.rmSync(root, { recursive: true, force: true });
  });
  const api = 'http://127.0.0.1:' + port + '/api';
  async function request(route: string, method = 'GET', body?: unknown) {
    const r = await fetch(api + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    for (const secret of ['fixture-password', 'fixture-cookie', 'secret_blob']) assert.ok(!text.includes(secret));
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }
  const untrusted = await fetch(api + '/integrations/credentials', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(untrusted.status, 403);
  assert.equal((await fetch(api + '/projects', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const account = integrations.saveCredential({ name: 'Reader', username: 'reader' }); integrations.setPassword(account.id, 'fixture-password');
  const connection = integrations.saveConnection({ ...integrationPresets[0], name: 'Docs', base_url: 'http://127.0.0.1:' + (remote.address() as { port: number }).port, credential_mode: 'credential', credential_id: account.id });
  assert.equal((await request('/integrations/connections/' + connection.id + '/check', 'POST')).body.user, 'Reader');
  assert.equal(logins, 1);
  const config = structuredClone(docsSourcePresets[0].config); config.children!.pagination!.limit = 1;
  const created = await request('/projects', 'POST', { kind: 'source', source_type: 'docs', name: 'Manual', key: 'manual', connection_id: connection.id, docs_config: config, docs_selection: [{ id: '1', include_descendants: true }] });
  assert.equal(created.status, 201);
  const id = created.body.id, route = '/projects/' + id;
  assert.equal(created.body.repo_path, sourceFolder(id));
  assert.equal((await request(route + '/docs/resolve', 'POST', { input: '/pages/viewpage.action?pageId=1' })).body.id, '1');
  assert.equal((await request(route + '/docs/children?id=1')).body.length, 1);
  assert.match((await request(route + '/docs/probe', 'POST', { input: '1' })).body.preview, /const x = 1/);
  assert.equal((await request(route + '/docs/sync', 'POST')).status, 202);
  for (let i = 0; isDocsSyncRunning(id) && i < 100; i++) await new Promise(r => setTimeout(r, 10));
  const synced = (await request(route)).body; assert.equal(synced.sync_status, 'done'); assert.equal(synced.sync_stats.added, 2);
  assert.ok(fs.existsSync(path.join(sourceFolder(id), 'INDEX.md')));
  assert.ok(events.some(e => e.type === 'docs-sync-progress'));
  assert.ok(events.some(e => e.type === 'docs-sync-status'));
  const folder = await request('/projects', 'POST', { name: 'Work', repo_path: path.join(root, 'work') });
  fs.mkdirSync(path.join(root, 'work'));
  assert.ok((await request('/projects/' + folder.body.id + '/mentions?q=manual')).body.some((m: { path: string }) => m.path === 'manual/'));
  assert.ok((await request('/projects/' + folder.body.id + '/mentions?q=manual/INDEX')).body.length);
  assert.equal((await request(route, 'PATCH', { repo_path: path.join(root, 'escape') })).body.repo_path, sourceFolder(id));
  slow = true;
  assert.equal((await request(route + '/docs/sync', 'POST')).status, 202);
  assert.equal((await request(route + '/docs/sync', 'POST')).status, 409);
  assert.equal((await request(route, 'PATCH', { name: 'busy' })).status, 400);
  assert.equal((await request(route + '/docs/cancel', 'POST')).body.sync_status, 'cancelled');
  assert.ok(fs.existsSync(path.join(sourceFolder(id), 'INDEX.md')));
  getDb().prepare("UPDATE projects SET sync_status='running' WHERE id=?").run(id);
  resetInterruptedDocsSyncs(); assert.equal((await request(route)).body.sync_status, 'cancelled');
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  const backup = sourceFolder(id) + '-backup'; fs.renameSync(sourceFolder(id), backup);
  fs.symlinkSync(outside, sourceFolder(id), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await request(route, 'DELETE')).status, 400);
  assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  fs.unlinkSync(sourceFolder(id)); fs.renameSync(backup, sourceFolder(id));
  assert.equal((await request(route + '/docs/sync', 'POST')).status, 202);
  assert.equal((await request(route, 'DELETE')).status, 204);
  assert.ok(!fs.existsSync(sourceFolder(id)));
  assert.ok(fs.existsSync(path.join(root, 'work')));
  integrations.setPassword(account.id, 'wrong');
  assert.equal((await request('/integrations/connections/' + connection.id + '/check', 'POST')).body.status, 'invalid_credentials');
  assert.equal(integrations.getCredential(account.id)?.status, 'needs_update');
});
