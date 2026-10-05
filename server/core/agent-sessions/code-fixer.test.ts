import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import express from 'express';
import type { WebSocket } from 'ws';

test('code fixer rounds, MCP isolation, developer decisions and instruction inheritance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-code-fixer-'));
  const cwd = process.cwd(), mock = path.resolve('scripts/mock-acp-agent.mjs');
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const sessions = await import('./sessions');
  const host = await import('./acp-host');
  const { createAgent } = await import('../agents');
  const { createProject } = await import('../projects');
  const { permissionDecision } = await import('./permissions');
  const { createReviewService } = await import('../code-reviews/reviews');
  const { createReviewStore } = await import('../code-reviews/store');
  const { mcpRouter, sessionMcpConfig, allowed } = await import('../../infrastructure/mcp/server');
  const { agentSessionsRouter } = await import('../../infrastructure/http/routes/agent-sessions');
  const { createCodeReviewsRouter } = await import('../../infrastructure/http/routes/code-reviews');
  const { resolveCodeFixerInstruction, DEFAULT_CODE_FIXER_INSTRUCTION } = await import('../library/code-fixer-instruction');
  const library = await import('../library');
  const { writeItemContent } = await import('../library/library-manager');
  const { syncItem } = await import('../library/syncer');
  const { addEventsClient } = await import('../shared/events');
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  sessions.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const events: Record<string, unknown>[] = [];
  const ws = Object.assign(new EventEmitter(), { readyState: 1, send: (data: string) => events.push(JSON.parse(data)) });
  addEventsClient(ws as unknown as WebSocket);
  const agent = createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath, acp_args: [mock] });
  const group = createProject({ name: 'Group', kind: 'group' });
  const project = createProject({ name: 'Project', repo_path: path.join(root, 'project'), group_id: group.id });
  const service = createReviewService(), store = createReviewStore();
  fs.mkdirSync(project.repo_path, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args],
    { cwd: project.repo_path, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(project.repo_path, 'code.ts'), 'original\n');
  git('add', '.'); git('commit', '-m', 'Initial');
  fs.writeFileSync(path.join(project.repo_path, 'code.ts'), 'changed\n');
  const before = git('diff', '--cached'), head = git('rev-parse', 'HEAD');
  const app = express();
  app.use(express.json()); app.use('/sessions', agentSessionsRouter); app.use('/mcp', mcpRouter);
  app.use('/projects/:projectId/reviews', createCodeReviewsRouter(() => service));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  process.env.PLANGENT_URL = base;
  const json = async (url: string, body: unknown) => fetch(base + url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ids: string[] = [];
  const ready = async (id: string) => {
    const deadline = Date.now() + 10_000;
    while (sessions.getSession(id).status !== 'ready') {
      if (Date.now() > deadline) throw new Error('Agent timed out');
      await new Promise(r => setTimeout(r, 25));
    }
  };
  try {
    assert.equal(resolveCodeFixerInstruction(project.id), DEFAULT_CODE_FIXER_INSTRUCTION);
    for (const [scope, targets, content] of [
      ['global', [], 'Global'], ['project', [group.id], 'Group'], ['project', [project.id], 'Project'],
    ] as const) {
      const item = library.createLibraryItem({ type: 'code-fixer-instruction', slug: content.toLowerCase(),
        title: content, scope, targets: [...targets] });
      writeItemContent(item, content);
      assert.equal(resolveCodeFixerInstruction(project.id), content);
      const filesBefore = fs.readdirSync(project.repo_path).sort();
      syncItem(item);
      assert.deepEqual(fs.readdirSync(project.repo_path).sort(), filesBefore);
      if (content === 'Project') library.updateLibraryItem(item.id, { enabled: false });
    }
    assert.equal(resolveCodeFixerInstruction(project.id), 'Group');
    // Restore the built-in instruction for the live agent.
    for (const item of library.listLibraryItems({ type: 'code-fixer-instruction' }))
      library.updateLibraryItem(item.id, { enabled: false });
    const created = await json('/sessions', { project_id: project.id, agent_id: agent.id, role: 'code-fixer', policy: 'allow-all' });
    assert.equal(created.status, 201);
    const session = await created.json() as { id: string };
    const id = session.id; ids.push(id);
    await ready(id);
    assert.deepEqual(allowed(sessions.getSession(id)), ['get_review', 'resolve_review_item']);
    for (const role of ['chat', 'executor', 'reviewer', 'librarian', 'analyst', 'planner'] as const)
      assert.ok(!allowed({ ...sessions.getSession(id), role }).includes('get_review'));
    assert.equal((await json('/sessions', { project_id: group.id, agent_id: agent.id, role: 'code-fixer' })).status, 400);
    const { review, item } = await service.addDraft(project.id, { scope: 'file', file: 'code.ts', kind: 'fix', text: 'Fix code' });
    const question = (await service.addDraft(project.id, { scope: 'general', kind: 'question', text: 'Why?' })).item;
    const sentResponse = await json('/projects/' + project.id + '/reviews/' + review.id + '/rounds', { session_id: id });
    assert.equal(sentResponse.status, 201);
    const sent = await sentResponse.json() as { round: { id: string; n: number; snapshot_tree: string }; items: { status: string }[] };
    assert.equal(sent.round.n, 1);
    assert.ok(sent.items.every(item => item.status === 'sent'));
    assert.equal(git('show', sent.round.snapshot_tree + ':code.ts'), 'changed');
    assert.equal(git('diff', '--cached'), before); assert.equal(git('rev-parse', 'HEAD'), head);
    await ready(id);
    sessions.updateSession(id, { status: 'thinking' });
    await assert.rejects(service.sendRound(project.id, review.id, id), /Agent is working/);
    sessions.updateSession(id, { status: 'ready' });
    const first = sessions.history(id).find(e => e.type === 'user')!;
    assert.equal(first.payload.briefing, true);
    assert.match(String(first.payload.text), /раунд 1: 1 замечаний, 1 вопросов/);
    const config = sessionMcpConfig(sessions.getSession(id), true)[0] as { headers: { name: string; value: string }[] };
    const call = async (name: string, args: unknown = {}, method = 'tools/call') => {
      const response = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', ...Object.fromEntries(config.headers.map(h => [h.name, h.value])) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'tools/list' ? {} : { name, arguments: args } }) });
      return await response.json() as { error?: unknown; result: { isError?: boolean; content: { text: string }[]; tools?: { name: string }[] } };
    };
    assert.deepEqual((await call('', {}, 'tools/list')).result.tools?.map(t => t.name), ['get_review', 'resolve_review_item']);
    assert.ok((await call('get_review')).error, 'MCP requires an active turn');
    sessions.updateSession(id, { status: 'thinking' });
    assert.equal(JSON.parse((await call('get_review')).result.content[0].text).review.id, review.id);
    assert.ok((await call('get_library')).error);
    assert.equal((await call('resolve_review_item', { id: item.id, status: 'rejected', answer: 'No' })).result.isError, true);
    assert.equal((await call('resolve_review_item', { id: question.id, status: 'done', answer: 'по итогам обсуждения' })).result.isError, true);
    assert.equal((await call('resolve_review_item', { id: question.id, status: 'answered', answer: 'Because' })).result.isError, undefined);
    assert.equal(store.getItem(question.id)!.status, 'answered');
    await call('resolve_review_item', { id: item.id, status: 'needs_decision', answer: 'Conflicts with architecture' });
    assert.equal(service.attention(project.id)[0].count, 1);
    assert.ok(events.some(e => e.type === 'code_review_needs_decision' && e.itemId === item.id));
    assert.equal((await service.current(project.id)).attention, 1);
    sessions.updateSession(id, { status: 'ready' });
    await service.decideItem(project.id, review.id, item.id, 'insist');
    assert.equal(store.getItem(item.id)!.status, 'sent');
    await ready(id);
    assert.match(String(sessions.history(id).filter(e => e.type === 'user').at(-1)!.payload.text), /Сделай как в замечании/);
    sessions.updateSession(id, { status: 'thinking' });
    await call('resolve_review_item', { id: item.id, status: 'needs_decision', answer: 'Still disagree' });
    await service.decideItem(project.id, review.id, item.id, 'agree');
    assert.equal(store.getItem(item.id)!.status, 'rejected');
    assert.deepEqual(service.attention(project.id), []);
    const other = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'code-fixer', policy: 'ask' });
    ids.push(other.id);
    sessions.updateSession(other.id, { status: 'ready' });
    await service.addDraft(project.id, { scope: 'general', kind: 'fix', text: 'Second round' });
    sessions.updateSession(id, { status: 'ready' });
    const second = await service.sendRound(project.id, review.id, other.id, 'Сначала разберись с типами');
    assert.equal(second.round.n, 2);
    assert.match(String(sessions.history(other.id).find(e => e.type === 'user')?.payload.text), /Комментарий разработчика: Сначала разберись с типами/);
    assert.equal((await service.current(project.id)).rounds.length, 2);
    await ready(other.id);
    await assert.rejects(service.resolveItem(sessions.getSession(other.id), question.id, 'answered', 'No'), /another chat/);
    sessions.addEvent(id, 'user', { text: 'I agree: make the change for the question.' });
    sessions.updateSession(id, { status: 'thinking' });
    await call('resolve_review_item', { id: question.id, status: 'done', answer: 'Исправлено по итогам обсуждения' });
    assert.equal(store.getItem(question.id)!.status, 'done');
    sessions.updateSession(id, { status: 'ready' });
    const thirdDraft = (await service.addDraft(project.id, { scope: 'general', kind: 'fix', text: 'Retry' })).item;
    const failing = createReviewService(getDb(), { sendPrompt: async () => { throw new Error('Delivery failed'); } });
    await assert.rejects(failing.sendRound(project.id, review.id, id), /Delivery failed/);
    assert.equal(store.getItem(thirdDraft.id)!.status, 'draft');
    assert.equal(store.listRounds(review.id).length, 2);
    const scope = { writable: [project.repo_path] };
    for (const command of ['git status', 'git commit -m x', 'git -C repo push', '"C:\\Program Files\\Git\\bin\\git.exe" reset', 'cmd /c git switch main']) {
      for (const policy of ['ask', 'allow-all', 'allow-edits'] as const)
        assert.equal(permissionDecision(policy, { toolCall: { toolCallId: 't', kind: 'execute', title: command }, options: [] } as never, undefined, scope, 'code-fixer'), 'deny', command);
    }
    const edit = (file: string) => ({ toolCall: { toolCallId: 't', kind: 'edit', title: 'Write', locations: [{ path: file }] }, options: [] } as never);
    assert.equal(permissionDecision('allow-all', edit('code.ts'), undefined, scope, 'code-fixer'), 'allow');
    assert.equal(permissionDecision('allow-all', { toolCall: { toolCallId: 't', kind: 'edit', title: 'Write',
      locations: [{ path: 'code.ts' }], content: [{ type: 'diff', path: 'code.ts', oldText: '', newText: 'git status is forbidden' }],
      rawInput: { text: 'git status is forbidden' } }, options: [] } as never, undefined, scope, 'code-fixer'), 'allow');
    assert.equal(permissionDecision('allow-all', edit('../outside.ts'), undefined, scope, 'code-fixer'), 'deny');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(project.repo_path, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(permissionDecision('allow-all', edit('external/new.ts'), undefined, scope, 'code-fixer'), 'deny');
    // Deleting a chat retains its items and clears only the round's session pointer.
    sessions.deleteSession(id);
    assert.equal(store.getItem(item.id)!.status, 'rejected');
    assert.equal(store.listRounds(review.id)[0].session_id, null);
    await service.removeReview(project.id, review.id);
    assert.equal(store.getReview(review.id), null);
    assert.throws(() => sessions.getSession(other.id));
  } finally {
    for (const id of ids) await host.closeSession(id).catch(() => {});
    ws.emit('close');
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close(); process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
