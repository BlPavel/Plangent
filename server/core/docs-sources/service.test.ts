import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-docs-service-'));
process.env.PLANGENT_DATA_DIR = root;

test('authenticated transport retries, DB status/statistics and cancellation through public facade', async t => {
  const { configureSecretVault, InMemoryVault } = await import('../../infrastructure/secrets');
  const { saveCredential, setPassword, saveConnection } = await import('../integrations');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject, getProject } = await import('../projects');
  const { syncDocsSource, sourceFolder, createDocsSource } = await import('./index');
  configureSecretVault(new InMemoryVault());
  let attempts = 0, deny = false;
  const remote = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('reader:fixture-password').toString('base64'));
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/who') { res.end('{"name":"reader"}'); return; }
    if (deny) { res.writeHead(403); res.end('{}'); return; }
    if (req.url === '/doc/root') {
      attempts++;
      if (attempts === 1) { res.writeHead(503, { 'Retry-After': '0' }); res.end('{}'); return; }
    }
    res.end(JSON.stringify({ id: 'root', title: 'Remote Guide', revision: 1, content: req.url?.startsWith('/meta/') ? undefined : '<p>Authenticated text</p>' }));
  });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(async () => {
    remote.closeAllConnections(); await new Promise<void>(resolve => remote.close(() => resolve()));
    getDb().close(); fs.rmSync(root, { recursive: true, force: true });
  });
  const address = remote.address(); assert.ok(address && typeof address === 'object');
  const credential = saveCredential({ name: 'Fixture reader', username: 'reader' }); setPassword(credential.id, 'fixture-password');
  const connection = saveConnection({ name: 'Fixture service', base_url: `http://127.0.0.1:${address.port}`, credential_mode: 'credential', credential_id: credential.id, auth_strategy: 'basic', auth_config: { check_path: '/who' } });
  const project = createProject({ kind: 'source', name: 'Remote docs', repo_path: path.join(root, 'placeholder') });
  const config = { document_endpoint: '/doc/{id}', metadata_endpoint: '/meta/{id}', fields: { id: 'id', title: 'title', body: 'content', version: 'revision' }, body_format: 'html', link_patterns: [{ pattern: '/doc/([^/?]+)', id_group: 1 }] };
  getDb().prepare("UPDATE projects SET source_type='docs',connection_id=?,docs_config=?,docs_selection=? WHERE id=?").run(connection.id, JSON.stringify(config), JSON.stringify([{ id: 'root', include_descendants: false }]), project.id);
  const result = await syncDocsSource(project.id);
  assert.equal(attempts, 2); assert.equal(result.stats.added, 1);
  assert.equal(getProject(project.id)?.sync_status, 'done'); assert.equal(getProject(project.id)?.sync_stats.added, 1);
  assert.equal(getProject(project.id)?.repo_path, sourceFolder(project.id)); assert.ok(getProject(project.id)?.last_sync_at);
  assert.match(fs.readFileSync(path.join(sourceFolder(project.id), result.manifest.entries.root.path), 'utf8'), /Authenticated text/);
  const controller = new AbortController();
  await assert.rejects(syncDocsSource(project.id, { signal: controller.signal, onProgress: progress => { if (progress.stage === 'download') controller.abort(); } }), { name: 'AbortError' });
  assert.equal(getProject(project.id)?.sync_status, 'cancelled');
  deny = true;
  await assert.rejects(syncDocsSource(project.id)); assert.equal(getProject(project.id)?.sync_status, 'error');
  assert.ok(fs.existsSync(path.join(sourceFolder(project.id), result.manifest.entries.root.path)));
  deny = false;
  const blocked = new AbortController(); blocked.abort();
  await assert.rejects(createDocsSource(connection.id, config).getDocument('root', blocked.signal), { name: 'AbortError' });
});
