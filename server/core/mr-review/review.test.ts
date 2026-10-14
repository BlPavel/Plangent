import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
test('GitLab token, group MR entry, cached sessions, inline drafts, replies and partial publication over HTTP', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-mr-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { configureSecretVault, InMemoryVault } = await import('../../infrastructure/secrets');
  configureSecretVault(new InMemoryVault());
  const { saveConnection, setPassword } = await import('../integrations');
  const { integrationPresets } = await import('../integrations/presets');
  const { checkConnection } = await import('../../infrastructure/http/integration-client');
  const { createProject } = await import('../projects');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createMrReviewRouter } = await import('../../infrastructure/http/routes/mr-review');
  let modern = false, head = 'a'.repeat(40), failBody = '', ambiguousBody = '', counter = 1, remoteCalls = 0, approvals = 0, versionId = 1;
  const user = { id: 5, name: 'Reviewer', username: 'reviewer' };
  const discussions: {
    id: string;
    notes: unknown[];
  }[] = [], remoteDrafts: {
    id: number;
    note: string;
    position?: unknown;
  }[] = [];
  const refs = () => ({ base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40), head_sha: head });
  const mr = () => ({ iid: 7, title: 'Feature', description: '', web_url: remoteUrl + '/team/service/-/merge_requests/7', state: 'opened', author: user, source_branch: 'feature', target_branch: 'main', sha: head, updated_at: String(versionId), diff_refs: refs() });
  const diff = () => ({ old_path: 'file.ts', new_path: 'file.ts', diff: '@@ -1,3 +1,3 @@\n context\n-removed\n+' + (versionId === 1 ? 'added' : 'changed') + '\n context2\n', new_file: false, deleted_file: false, renamed_file: false });
  let remoteUrl = '';
  const remote = createServer(async (req, res) => {
    remoteCalls++;
    if (req.headers['private-token'] !== 'secret-pat') {
      res.writeHead(401);
      res.end();
      return;
    }
    const u = new URL(req.url!, remoteUrl), suffix = u.pathname.replace('/api/v4/projects/team%2Fservice/merge_requests/7', '');
    const json = (v: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'X-Next-Page': '' });
      res.end(JSON.stringify(v));
    };
    let raw = '';
    for await (const chunk of req)
      raw += chunk;
    const data = raw ? JSON.parse(raw) : {};
    if (u.pathname === '/api/v4/user')
      return json(user);
    if (u.pathname === '/api/v4/version')
      return json({ version: '16.11.0' });
    if (u.pathname === '/api/v4/personal_access_tokens/self')
      return json({ expires_at: '2027-01-01' });
    if (u.pathname === '/api/v4/projects/team%2Fservice/merge_requests')
      return json([mr()]);
    if (u.pathname.startsWith('/api/v4/projects/team%2Fservice/repository/files/')) {
      res.end('context\n' + (versionId === 1 ? 'added' : 'changed') + '\ncontext2\n');
      return;
    }
    if (suffix === '' && req.method === 'GET')
      return json(mr());
    if (suffix === '/versions')
      return json([{ id: versionId, base_commit_sha: refs().base_sha, start_commit_sha: refs().start_sha, head_commit_sha: head, created_at: '2026-01-01' }]);
    if (suffix.startsWith('/versions/'))
      return json({ diffs: [diff()] });
    if (suffix === '/approvals')
      return json({});
    if (suffix === '/approve' || suffix === '/unapprove') {
      approvals++;
      return json({});
    }
    if (suffix === '/discussions' && req.method === 'GET')
      return json(discussions);
    if (suffix === '/discussions' && req.method === 'POST') {
      if (data.body === failBody)
        return json({}, 400);
      if (data.body === ambiguousBody) {
        req.socket.destroy();
        return;
      }
      const d = { id: String(counter++), notes: [{ id: counter, body: data.body, position: data.position, author: user }] };
      discussions.push(d);
      return json(d);
    }
    if (suffix.includes('/discussions/') && suffix.endsWith('/notes')) {
      const d = discussions.find(d => suffix.includes('/' + d.id + '/'))!;
      const note = { id: counter++, body: data.body, author: user };
      d.notes.push(note);
      return json(note);
    }
    if (suffix === '/draft_notes') {
      if (!modern)
        return json({}, 404);
      if (req.method === 'GET')
        return json(remoteDrafts);
      const d = { id: counter++, note: data.note, position: data.position };
      remoteDrafts.push(d);
      return json(d);
    }
    if (suffix === '/draft_notes/bulk_publish') {
      for (const d of remoteDrafts.splice(0))
        discussions.push({ id: String(d.id), notes: [{ id: d.id, body: d.note, position: d.position, author: user }] });
      return json({});
    }
    return json({}, 404);
  });
  remote.listen(0, '127.0.0.1');
  await once(remote, 'listening');
  remoteUrl = 'http://127.0.0.1:' + (remote.address() as {
    port: number;
  }).port;
  const app = express();
  app.use(express.json());
  app.use('/projects/:projectId/mr-review', createMrReviewRouter());
  const local = app.listen(0, '127.0.0.1');
  await once(local, 'listening');
  const base = 'http://127.0.0.1:' + (local.address() as {
    port: number;
  }).port;
  try {
    const preset = integrationPresets.find(p => p.id === 'gitlab-token')!;
    const connection = saveConnection({ name: 'GitLab', base_url: remoteUrl, code_host: preset.code_host, auth_strategy: preset.auth_strategy, auth_config: preset.auth_config, credential_mode: 'own', own_credential: { username: 'token' } });
    setPassword(connection.credential_id!, 'secret-pat');
    const check = await checkConnection(connection.id);
    assert.equal(check.user, 'Reviewer');
    assert.equal(check.version, '16.11.0');
    assert.equal(check.token_expires_at, '2027-01-01');
    assert.ok(!JSON.stringify(connection).includes('secret-pat'));
    const group = createProject({ kind: 'group', name: 'Services', repo_path: root, connection_id: connection.id });
    const project = createProject({ name: 'Service', repo_path: root, group_id: group.id, host_project_path: 'team/service' });
    const otherRoot = path.join(root, 'other');
    fs.mkdirSync(otherRoot);
    const other = createProject({ name: 'Other', repo_path: otherRoot });
    async function api(url: string, method = 'GET', body?: unknown, expected = 200) {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await r.json() as any;
      assert.equal(r.status, expected, JSON.stringify(data));
      return data;
    }
    const prefix = '/projects/' + group.id + '/mr-review';
    assert.equal((await api(prefix)).requests.length, 1);
    let detail = await api(prefix + '/open', 'POST', { url: remoteUrl + '/team/service/-/merge_requests/7' });
    const id = detail.session.id, url = prefix + '/' + id;
    assert.equal(detail.session.project_id, project.id);
    const calls = remoteCalls;
    await api(url);
    assert.equal(remoteCalls, calls, 'cached read must not synchronize');
    await api('/projects/' + other.id + '/mr-review/' + id, 'GET', undefined, 404);
    await api(url + '/file?path=file.ts');
    await api(url + '/file?path=file.ts&head=outdated', 'GET', undefined, 409);
    await api(url + '/drafts', 'POST', { body: 'Wrong snapshot', path: 'file.ts', side: 'new', line: 2, head: 'outdated' }, 409);
    const first = await api(url + '/drafts', 'POST', { body: 'First', path: 'file.ts', side: 'new', line: 2 }, 201);
    assert.equal(first.position.new_line, 2);
    assert.equal(first.position.old_line, undefined);
    assert.equal(discussions.length, 0);
    await api(url + '/publish', 'POST', { ids: [first.id], confirmed: false }, 400);
    detail = await api(url + '/publish', 'POST', { ids: [first.id], confirmed: true });
    assert.equal(detail.drafts[0].status, 'sent');
    assert.equal(discussions.length, 1);
    await api(url + '/publish', 'POST', { ids: [first.id], confirmed: true }, 409);
    await api(url + '/discussions/' + discussions[0].id + '/reply', 'POST', { body: 'Reply' });
    assert.equal(discussions[0].notes.length, 2);
    await api(url + '/approve', 'POST', { approved: true });
    await api(url + '/approve', 'POST', { approved: false });
    assert.equal(approvals, 2);
    const good = await api(url + '/drafts', 'POST', { body: 'Good' }, 201), bad = await api(url + '/drafts', 'POST', { body: 'Bad' }, 201);
    failBody = 'Bad';
    detail = await api(url + '/publish', 'POST', { ids: [good.id, bad.id], confirmed: true });
    assert.equal(detail.drafts.find((d: any) => d.id === good.id).status, 'sent');
    assert.equal(detail.drafts.find((d: any) => d.id === bad.id).status, 'draft');
    failBody = '';
    await api(url + '/publish', 'POST', { ids: [bad.id], confirmed: true });
    assert.equal(discussions.filter(d => (d.notes[0] as any).body === 'Good').length, 1);
    await api(url + '/viewed', 'PUT', { path: 'file.ts', viewed: true });
    const stale = await api(url + '/drafts', 'POST', { body: 'Stale', path: 'file.ts', side: 'old', line: 3 }, 201);
    head = 'd'.repeat(40);
    versionId = 2;
    assert.equal((await api(prefix)).requests[0].has_updates, true);
    await api(url + '/publish', 'POST', { ids: [stale.id], confirmed: true }, 409);
    detail = await api(url + '/refresh', 'POST', {});
    assert.equal(detail.viewed.length, 0);
    assert.equal(detail.changed_files[0], 'file.ts');
    assert.equal(detail.session.previous.version.id, 1);
    await api(url + '/drafts/' + stale.id, 'DELETE');
    modern = true;
    const batch1 = await api(url + '/drafts', 'POST', { body: 'Batch one', path: 'file.ts', side: 'new', line: 2 }, 201);
    const batch2 = await api(url + '/drafts', 'POST', { body: 'Batch two' }, 201);
    detail = await api(url + '/publish', 'POST', { ids: [batch1.id, batch2.id], confirmed: true });
    assert.equal(detail.drafts.filter((d: any) => [batch1.id, batch2.id].includes(d.id)).every((d: any) => d.status === 'sent'), true);
    assert.equal(remoteDrafts.length, 0);
    modern = false;
    ambiguousBody = 'Unknown';
    const unknown = await api(url + '/drafts', 'POST', { body: 'Unknown' }, 201);
    detail = await api(url + '/publish', 'POST', { ids: [unknown.id], confirmed: true });
    assert.equal(detail.drafts.find((d: any) => d.id === unknown.id).status, 'uncertain');
    await api(url + '/publish', 'POST', { ids: [unknown.id], confirmed: true }, 409);
    await api(url + '/drafts/' + unknown.id + '/recover', 'POST', { published: false, confirmed: false }, 400);
    detail = await api(url + '/drafts/' + unknown.id + '/recover', 'POST', { published: false, confirmed: true });
    assert.equal(detail.drafts.find((d: any) => d.id === unknown.id).status, 'draft');
    await api(prefix + '/open', 'POST', { url: 'https://other.example/team/service/-/merge_requests/7' }, 400);
  }
  finally {
    local.closeAllConnections();
    remote.closeAllConnections();
    await Promise.all([new Promise<void>(r => local.close(() => r())), new Promise<void>(r => remote.close(() => r()))]);
    getDb().close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
