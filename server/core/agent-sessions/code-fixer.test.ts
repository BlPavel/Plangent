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
    assert.deepEqual(allowed(sessions.getSession(id)), ['get_review', 'start_review_item', 'reply_review_item']);
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
    // The round message only announces the items; their text comes from get_review.
    assert.match(String(first.payload.text), /раунд 1: 2 новых пункта\. Возьми их через get_review/);
    assert.doesNotMatch(String(first.payload.text), /Fix code/);
    const config = sessionMcpConfig(sessions.getSession(id), true)[0] as { headers: { name: string; value: string }[] };
    const call = async (name: string, args: unknown = {}, method = 'tools/call') => {
      const response = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', ...Object.fromEntries(config.headers.map(h => [h.name, h.value])) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'tools/list' ? {} : { name, arguments: args } }) });
      return await response.json() as { error?: unknown; result: { isError?: boolean; content: { text: string }[]; tools?: { name: string }[] } };
    };
    assert.deepEqual((await call('', {}, 'tools/list')).result.tools?.map(t => t.name), ['get_review', 'start_review_item', 'reply_review_item']);
    assert.ok((await call('get_review')).error, 'MCP requires an active turn');
    sessions.updateSession(id, { status: 'thinking' });
    const fetched = JSON.parse((await call('get_review')).result.content[0].text);
    assert.equal(fetched.review.id, review.id);
    assert.ok(fetched.protocol.some((rule: string) => rule.includes('disagree')));
    assert.deepEqual(fetched.assigned.map((i: { id: string }) => i.id).sort(), [item.id, question.id].sort());
    assert.deepEqual(fetched.history, []);
    assert.ok((await call('get_library')).error);
    // Replies are typed; a question cannot be "fixed" before the developer asks for it in the thread.
    assert.equal((await call('reply_review_item', { id: item.id, kind: 'rejected', text: 'No' })).result.isError, true);
    assert.equal((await call('reply_review_item', { id: question.id, kind: 'change', text: 'Changed' })).result.isError, true);
    assert.equal((await call('start_review_item', { id: question.id })).result.isError, undefined);
    assert.ok(sessions.history(id).some(e => e.type === 'review_focus' && e.payload.item_id === question.id));
    assert.equal((await call('reply_review_item', { id: question.id, kind: 'options', text: 'Pick', options: [{ label: 'A' }] })).result.isError, true);
    assert.equal((await call('reply_review_item', { id: question.id, kind: 'options', text: '1. A\n2. B (recommended)' })).result.isError, undefined);
    assert.equal(store.getItem(question.id)!.status, 'answered');
    assert.deepEqual(store.listMessages(review.id, question.id)[0].options, []);
    assert.equal(store.listMessages(review.id, question.id)[0].text, '1. A\n2. B (recommended)');
    await call('reply_review_item', { id: item.id, kind: 'disagree', text: 'Conflicts with architecture' });
    assert.equal(service.attention(project.id)[0].count, 2, 'Both threads wait for the developer');
    assert.ok(events.some(e => e.type === 'code_review_needs_decision' && e.itemId === item.id));
    assert.equal((await service.current(project.id)).attention, 2);
    assert.equal((await call('reply_review_item', { id: item.id, kind: 'answer', text: 'Again' })).result.isError, true, 'One reply per turn');
    sessions.updateSession(id, { status: 'ready' });
    // The developer answers in the threads; replies wait for the batch.
    await assert.rejects(service.addMessage(project.id, review.id, item.id, { text: ' ' }), /text required/);
    await service.addMessage(project.id, review.id, item.id, { kind: 'implement', text: 'Настаиваю: сделай как в замечании' });
    await service.addMessage(project.id, review.id, question.id, { kind: 'text', text: 'Сделай вариант B' });
    assert.deepEqual(service.attention(project.id), [], 'queued developer replies no longer need their attention');
    assert.equal((await service.current(project.id)).attention, 0);
    await assert.rejects(service.closeItem(project.id, review.id, question.id, 'accept'), /queued reply/);
    const quiet = createReviewService(getDb(), { sendPrompt: async () => {} });
    const batch = await quiet.sendRound(project.id, review.id, id);
    assert.deepEqual(batch.items.map(i => i.id).sort(), [item.id, question.id].sort());
    assert.ok(store.listMessages(review.id).filter(m => m.author === 'developer').every(m => m.sent && m.round_id === batch.round.id));
    sessions.updateSession(id, { status: 'thinking' });
    const thread = JSON.parse((await call('get_review')).result.content[0].text).assigned.find((i: { id: string }) => i.id === question.id).thread;
    assert.deepEqual(thread.at(-1), { author: 'developer', kind: 'text', text: 'Сделай вариант B' });
    assert.equal((await call('reply_review_item', { id: question.id, kind: 'change', text: 'Did B', files: ['code.ts'] })).result.isError, undefined);
    await call('reply_review_item', { id: item.id, kind: 'change', text: 'Done as asked' });
    sessions.updateSession(id, { status: 'ready' });
    assert.equal((await service.closeItem(project.id, review.id, question.id, 'accept')).closed, true);
    assert.equal((await service.closeItem(project.id, review.id, item.id, 'reject')).status, 'rejected');
    assert.deepEqual(service.attention(project.id), []);
    const other = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'code-fixer', policy: 'ask' });
    ids.push(other.id);
    sessions.updateSession(other.id, { status: 'ready' });
    await service.addDraft(project.id, { scope: 'general', kind: 'fix', text: 'Second round' });
    const second = await service.sendRound(project.id, review.id, other.id, 'Сначала разберись с типами');
    assert.equal(second.round.n, 3);
    assert.match(String(sessions.history(other.id).find(e => e.type === 'user')?.payload.text), /Комментарий разработчика: Сначала разберись с типами/);
    assert.equal((await service.current(project.id)).rounds.length, 3);
    await ready(other.id);
    await assert.rejects(service.replyItem(sessions.getSession(other.id), question.id, { kind: 'answer', text: 'No' }), /another chat/);
    // Writing to a closed thread reopens it; a failed delivery puts the reply back in the queue.
    await service.addMessage(project.id, review.id, question.id, { text: 'А почему B?' });
    assert.equal(store.getItem(question.id)!.closed, false);
    const thirdDraft = (await service.addDraft(project.id, { scope: 'general', kind: 'fix', text: 'Retry' })).item;
    const failing = createReviewService(getDb(), { sendPrompt: async () => { throw new Error('Delivery failed'); } });
    await assert.rejects(failing.sendRound(project.id, review.id, id), /Delivery failed/);
    assert.equal(store.getItem(thirdDraft.id)!.status, 'draft');
    assert.equal(store.getItem(question.id)!.status, 'done');
    const queued = store.listMessages(review.id, question.id).filter(m => m.author === 'developer' && !m.sent);
    assert.equal(queued.length, 1);
    assert.equal(store.listRounds(review.id).length, 3);
    await assert.rejects(quiet.sendRound(project.id, review.id, id, '', [item.id]), /Nothing to send/);
    await service.removeMessage(project.id, review.id, question.id, queued[0].id);
    await service.closeItem(project.id, review.id, question.id, 'accept');
    // «Остановить»: the agent stops; threads it did not answer return to the queue and can be sent again.
    const stuck = (await service.addDraft(project.id, { scope: 'general', kind: 'fix', text: 'Stuck' })).item;
    await quiet.sendRound(project.id, review.id, id);
    sessions.updateSession(id, { status: 'thinking' });
    assert.equal((await service.current(project.id)).agent_working, true);
    assert.equal(store.getItem(stuck.id)!.status, 'sent', 'A working agent keeps its threads');
    const stopper = createReviewService(getDb(), { cancelSession: async sid => { sessions.updateSession(sid, { status: 'ready' }); }, closeSession: async () => {} });
    assert.equal((await stopper.stop(project.id, review.id)).stopped, 1);
    assert.equal(store.getItem(stuck.id)!.status, 'draft');
    assert.equal(store.getItem(stuck.id)!.round_id, null);
    assert.equal((await service.current(project.id)).agent_working, false);
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
