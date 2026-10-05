import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

test('code HTTP contract and events subscription on a real repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-code-http-'));
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args],
    { cwd: repo, encoding: 'utf8', windowsHide: true });
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(repo, 'code.ts'), 'original\n');
  git('add', '.'); git('commit', '-m', 'Initial');
  await fs.writeFile(path.join(repo, 'code.ts'), 'changed Needle\n');
  await fs.writeFile(path.join(repo, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const { codeRouter } = await import('../../infrastructure/http/routes/code');
  const { attachCodeSubscriptions } = await import('../../infrastructure/http/code-subscriptions');
  const project = createProject({ name: 'Code API', repo_path: repo });
  const app = express();
  app.use('/api/projects/:projectId/code', codeRouter);
  const server = app.listen(0, '127.0.0.1');
  const wss = new WebSocketServer({ server });
  wss.on('connection', attachCodeSubscriptions);
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const base = 'http://127.0.0.1:' + port + '/api/projects/' + project.id + '/code';
  const socket = new WebSocket('ws://127.0.0.1:' + port + '/ws/events');
  const messages: { type: string; projectId?: string }[] = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await once(socket, 'open');
  const request = (url: string) => fetch(base + url);
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'Timed out waiting for event');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    assert.ok((await (await request('/repository')).json() as { head: string }).head);
    assert.ok((await (await request('/changes')).json() as { path: string }[]).some(c => c.path === 'code.ts'));
    assert.ok((await (await request('/files')).json() as string[]).includes('code.ts'));
    assert.ok((await (await request('/tree')).json() as { path: string }[]).some(c => c.path === 'code.ts'));
    assert.equal((await (await request('/file?path=code.ts')).json() as { content: string }).content, 'changed Needle\n');
    assert.equal((await (await request('/old-file?path=code.ts')).json() as { content: string }).content, 'original\n');
    assert.match((await (await request('/diff?path=code.ts')).json() as { diff: string }).diff, /\+changed Needle/);
    const image = await request('/image?path=image.svg');
    assert.match(image.headers.get('content-type')!, /image\/svg/);
    assert.match(image.headers.get('content-security-policy')!, /sandbox/);
    assert.match(await image.text(), /<svg/);
    const search = await request('/search?q=Needle&mask=*.ts');
    assert.match(search.headers.get('content-type')!, /ndjson/);
    const events = (await search.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].path, 'code.ts');
    assert.deepEqual(events[1], { type: 'done', matches: 1, files: 1, truncated: false });
    for (const url of ['/file?path=..%2Fsecret', '/file?path=.git/config', '/tree?includeIgnored=yes', '/search?q=%5B&regex=true'])
      assert.equal((await request(url)).status, 400, url);
    assert.equal((await request('/file?path=missing')).status, 404);
    assert.equal((await fetch(base.replace(project.id, 'unknown') + '/tree')).status, 404);
    assert.equal((await fetch(base + '/files', { headers: { Origin: 'https://example.com' } })).status, 403);
    socket.send(JSON.stringify({ type: 'code:subscribe', projectId: project.id }));
    await waitFor(() => messages.some(e => e.type === 'code:subscribed'));
    socket.send(JSON.stringify({ type: 'code:subscribe', projectId: project.id }));
    await waitFor(() => messages.filter(e => e.type === 'code:subscribed').length === 2);
    await fs.writeFile(path.join(repo, 'code.ts'), 'external edit\n');
    if (process.platform === 'linux') git('add', 'code.ts');
    await waitFor(() => messages.some(e => e.type === 'code:changed' && e.projectId === project.id));
    socket.send(JSON.stringify({ type: 'code:unsubscribe', projectId: project.id }));
    await waitFor(() => messages.some(e => e.type === 'code:unsubscribed'));
    const count = messages.filter(e => e.type === 'code:changed').length;
    await fs.writeFile(path.join(repo, 'code.ts'), 'after unsubscribe\n');
    if (process.platform === 'linux') git('add', 'code.ts');
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(messages.filter(e => e.type === 'code:changed').length, count);
    socket.send(JSON.stringify({ type: 'code:subscribe', projectId: 'unknown' }));
    await waitFor(() => messages.some(e => e.type === 'code:error'));
  } finally {
    socket.close();
    await once(socket, 'close');
    await new Promise<void>(resolve => wss.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
