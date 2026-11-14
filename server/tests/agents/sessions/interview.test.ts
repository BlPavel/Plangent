import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';

test('preparation settings and interview: live MCP instructions, role access, outbound pointer and original history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-interview-'));
  const previousCwd = process.cwd();
  const previousData = process.env.PLANGENT_DATA_DIR;
  const previousUrl = process.env.PLANGENT_URL;
  const mockAgent = path.resolve('server/tests/support/mock-acp-agent.mjs');
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../../infrastructure/db/schema');
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { createTask } = await import('../../../core-services').then(() => import('../../../core/tasks'));
  const { createAgent } = await import('../../../core-services').then(() => import('../../../core/agents/catalog'));
  const { initSessions, createSession, history, updateSession, addEvent } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const host = await import('../../../core-services').then(() => import('../../../core/agents/sessions/acp-host'));
  const { commandPrompt, sessionCommands } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/commands'));
  const { interviewGuide, interviewPending, DEFAULT_INTERVIEW_INSTRUCTION } = await import('../../../core-services').then(() => import('../../../core/library/interview-instruction'));
  const { libraryRouter } = await import('../../../core-services').then(() => import('../../../api/http/routes/library'));
  const { mcpRouter, sessionMcpConfig, allowed } = await import('../../../core-services').then(() => import('../../../api/mcp/server'));
  const { MATERIAL_KINDS } = await import('../../../core-services').then(() => import('../../../core/preparation/materials/kinds'));
  const { materialReviewSkills } = await import('../../../core-services').then(() => import('../../../core/library/section-settings'));
  const { killProcessTree } = await import('../../../infrastructure/terminal/process-tree');
  initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const project = createProject({ name: 'Interview', repo_path: root });
  const task = createTask({ project_id: project.id, key: 'INTERVIEW' });
  const agent = createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath, acp_args: [mockAgent, '--inspect-workspace'] });
  const make = (role: 'material-author' | 'analyst' | 'planner' | 'executor', material_type?: string) => {
    const session = createSession({ project_id: project.id, task_id: task.id, agent_id: agent.id, role, policy: 'read-only', metadata: { material_type } });
    return updateSession(session.id, { status: 'thinking' });
  };
  const architect = make('material-author', 'architecture'), qa = make('material-author', 'qa'), executor = make('executor');
  const app = express(); app.use(express.json()); app.use('/library', libraryRouter); app.use('/mcp', mcpRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.PLANGENT_URL = url;
  const request = async (route: string, method = 'GET', body?: unknown): Promise<Record<string, string>> => {
    const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok(response.ok, await response.clone().text());
    return response.status === 204 ? {} : response.json() as Promise<Record<string, string>>;
  };
  const call = async (session: typeof architect, name: string, args: Record<string, unknown> = {}) => {
    const config = sessionMcpConfig(session, true)[0] as { url: string; headers: { name: string; value: string }[] };
    const response = await fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...Object.fromEntries(config.headers.map(h => [h.name, h.value])) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return response.json() as Promise<{ error?: unknown; result?: { isError?: boolean; content: { text: string }[] } }>;
  };
  const read = async (session: typeof architect, name: string, args: Record<string, unknown> = {}) => {
    const result = await call(session, name, args); assert.ok(!result.error && !result.result?.isError, JSON.stringify(result));
    return JSON.parse(result.result!.content[0].text);
  };
  try {
    const settings = await request('/library', 'POST', { type: 'architecture-template', slug: 'architecture', title: 'Architecture', scope: 'global', content: 'CUSTOM ARCHITECTURE' });
    assert.equal((await read(architect, 'get_material')).template, 'CUSTOM ARCHITECTURE');
    await request('/library/' + settings.id, 'DELETE');
    assert.equal((await read(architect, 'get_material')).template, MATERIAL_KINDS.architecture.defaultTemplate);
    const skill = await request('/library', 'POST', { type: 'qa-review-skill', slug: 'qa_rules', title: 'QA rules', scope: 'project', targets: [project.id], content: 'DOMAIN QA' });
    assert.deepEqual(materialReviewSkills('qa', project.id).map(s => s.id), [skill.id]);
    assert.deepEqual(materialReviewSkills('architecture', project.id), []);

    assert.equal((await read(architect, 'get_interview_guide')).section, 'architecture');
    assert.equal((await read(qa, 'get_interview_guide')).section, 'qa');
    assert.match(interviewGuide(make('analyst')).focus, /Requirements/);
    assert.match(interviewGuide(make('planner')).focus, /Implementation/);
    assert.ok(!allowed(executor).includes('get_interview_guide'));
    const denied = await call(executor, 'get_interview_guide');
    assert.ok(denied.error || denied.result?.isError);
    assert.deepEqual(sessionCommands(executor), []);
    assert.equal(sessionCommands(qa)[0].source, 'plangent');
    const original = [{ type: 'text' as const, text: '/interview что-то' }];
    assert.deepEqual(commandPrompt(executor, original), original);
    assert.deepEqual(commandPrompt(architect, [{ type: 'text', text: '/agent:interview native' }]), [{ type: 'text', text: '/interview native' }]);
    assert.deepEqual(commandPrompt(architect, [{ type: 'text', text: 'mention /interview later' }]), [{ type: 'text', text: 'mention /interview later' }]);
    assert.deepEqual(commandPrompt(architect, [{ type: 'text', text: '/interviewer' }]), [{ type: 'text', text: '/interviewer' }]);

    const round = { round: 1, total_rounds: 2, topic: 'Данные', upcoming: ['Проверки'], questions: [{ id: 'items', text: 'Формат элементов?', options: [{ label: 'Массив { id, text }', detail: 'Стабильные ключи', recommended: true }, { label: 'Массив строк' }] }] };
    assert.deepEqual(await read(qa, 'ask_interview_questions', round), { shown: true, next: 'End your turn now. The developer’s answers arrive as the next message. Do not do the requested work before the interview ends.' });
    assert.deepEqual(history(qa.id).filter(e => e.type === 'interview_questions').map(e => e.payload), [round]);
    for (const invalid of [
      { ...round, questions: [{ text: 'Один вариант?', options: [{ label: 'Да' }] }] },
      { ...round, questions: [{ text: 'Две рекомендации?', options: [{ label: 'A', recommended: true }, { label: 'B', recommended: true }] }] },
      { ...round, round: 3 },
      { ...round, questions: [] },
    ]) {
      const result = await call(qa, 'ask_interview_questions', invalid);
      assert.ok(result.error || result.result?.isError, JSON.stringify(invalid));
    }
    assert.equal(history(qa.id).filter(e => e.type === 'interview_questions').length, 1);
    assert.ok(!allowed(executor).includes('ask_interview_questions'));

    // The section waits for the whole interview, whatever the developer asked for.
    const save = () => call(qa, 'submit_material', { content: '# QA' });
    const blocked = async (pattern: RegExp) => { const result = await save(); assert.ok(result.result?.isError, JSON.stringify(result)); assert.match(result.result!.content[0].text, pattern); };
    const notBlocked = async () => { const result = await save(); assert.doesNotMatch(JSON.stringify(result), /interview is in progress/); };
    const answer = (roundSeq: number, answers: unknown[], finish = false) => addEvent(qa.id, 'user', { text: 'answers', content: [{ type: 'text', text: 'answers', _meta: { plangent_interview: { round_seq: roundSeq, answers, ...(finish ? { finish } : {}) } } }] });
    const lastRound = () => history(qa.id).filter(e => e.type === 'interview_questions').at(-1)!.seq;
    await blocked(/wait for the developer's answers to round 1/);
    answer(lastRound(), [{ question_id: 'items', kind: 'option', index: 0 }]);
    await blocked(/ask round 2 of 2/);
    await read(qa, 'ask_interview_questions', { ...round, round: 2 });
    answer(lastRound(), [{ question_id: 'items', kind: 'clarify', text: 'Что такое id?' }]);
    await blocked(/clarify/);
    await read(qa, 'ask_interview_questions', { ...round, round: 3, total_rounds: 3 });
    answer(lastRound(), [{ question_id: 'items', kind: 'option', index: 1 }]);
    await notBlocked();
    await read(qa, 'ask_interview_questions', { ...round, round: 1, total_rounds: 4 });
    await blocked(/round 1/);
    answer(lastRound(), [], true);
    await notBlocked();
    assert.equal(interviewPending([]), null);
    assert.equal((await read(architect, 'get_interview_guide')).ask, 'ask_interview_questions');

    const instruction = await request('/library', 'POST', { type: 'interview-instruction', slug: 'interview', title: 'Interview', scope: 'global', content: 'CUSTOM GUIDE' });
    assert.equal((await read(architect, 'get_interview_guide')).instruction, 'CUSTOM GUIDE');
    const invalid = await fetch(url + '/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'interview-instruction', slug: 'invalid', title: 'Invalid', scope: 'project', targets: [project.id] }) });
    assert.equal(invalid.status, 400);
    await request('/library/' + instruction.id, 'DELETE');
    assert.equal((await read(architect, 'get_interview_guide')).instruction, DEFAULT_INTERVIEW_INSTRUCTION);
    assert.equal((await request('/library/interview-instruction/defaults')).content, DEFAULT_INTERVIEW_INSTRUCTION);

    updateSession(architect.id, { status: 'ready' });
    await host.sendPrompt(architect.id, original);
    const deadline = Date.now() + 10_000;
    while (!history(architect.id).some(e => e.type === 'turn_end')) {
      if (Date.now() > deadline) throw new Error('Mock agent timed out');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const outbound = JSON.parse(String(history(architect.id).find(e => e.type === 'assistant')!.payload.text));
    const prompt = JSON.stringify(outbound.prompt);
    assert.match(prompt, /get_interview_guide/);
    assert.match(prompt, /что-то/);
    assert.ok(!prompt.includes(DEFAULT_INTERVIEW_INSTRUCTION) && !prompt.includes('CUSTOM GUIDE'));
    assert.equal(history(architect.id).find(e => e.type === 'user')!.payload.text, '/interview что-то');
    assert.equal(host.snapshot(architect.id).commands[0].name, 'interview');
  } finally {
    await host.shutdownSessions();
    await new Promise<void>(resolve => server.close(() => resolve()));
    getDb().close();
    process.chdir(previousCwd);
    if (previousData === undefined) delete process.env.PLANGENT_DATA_DIR; else process.env.PLANGENT_DATA_DIR = previousData;
    if (previousUrl === undefined) delete process.env.PLANGENT_URL; else process.env.PLANGENT_URL = previousUrl;
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
