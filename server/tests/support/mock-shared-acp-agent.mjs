import { agent, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
const sessions = new Map();
let sequence = 0;
let initialized = false;
const update = (ctx, sessionId, text) => ctx.client.notify('session/update', {
  sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
});
agent({ name: 'mock-shared' })
  .onRequest('initialize', () => {
    if (initialized) throw new Error('Initialized twice');
    initialized = true;
    return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {
      loadSession: true, mcpCapabilities: { http: true },
      ...(process.env.MOCK_NO_CLOSE ? {} : { sessionCapabilities: { close: {} } }),
    } };
  })
  .onRequest('session/new', async ctx => {
    if (ctx.params.cwd.endsWith('fail')) throw new Error('Failed new session');
    const sessionId = `session-${++sequence}`;
    sessions.set(sessionId, { ...ctx.params, mode: 'default', cancelled: false });
    await update(ctx, sessionId, 'early:' + sessionId);
    return { sessionId };
  })
  .onRequest('session/load', async ctx => {
    sessions.set(ctx.params.sessionId, { ...ctx.params, mode: 'default', cancelled: false });
    await update(ctx, ctx.params.sessionId, 'replay:' + ctx.params.sessionId);
    return {};
  })
  .onRequest('session/close', ctx => {
    if (process.env.MOCK_FAIL_CLOSE) throw new Error('Failed close');
    const session = sessions.get(ctx.params.sessionId);
    if (session) session.cancelled = true;
    sessions.delete(ctx.params.sessionId);
    return {};
  })
  .onRequest('session/set_mode', ctx => { sessions.get(ctx.params.sessionId).mode = ctx.params.modeId; return {}; })
  .onNotification('session/cancel', ctx => {
    const session = sessions.get(ctx.params.sessionId);
    if (session) session.cancelled = true;
  })
  .onRequest('session/prompt', async ctx => {
    const { sessionId } = ctx.params;
    const session = sessions.get(sessionId);
    if (!session) throw new Error('Session closed');
    const text = ctx.params.prompt.map(p => p.text ?? '').join('');
    if (text === 'crash') { process.exit(7); }
    session.cancelled = false;
    if (text === 'hold') while (!session.cancelled) await new Promise(resolve => setTimeout(resolve, 10));
    if (text === 'permission') {
      const answer = await ctx.client.request('session/request_permission', {
        sessionId, toolCall: { toolCallId: sessionId, kind: 'other', title: sessionId },
        options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }, { optionId: 'no', name: 'No', kind: 'reject_once' }],
      });
      await update(ctx, sessionId, JSON.stringify(answer));
    }
    await update(ctx, sessionId, JSON.stringify({ text, cwd: session.cwd, mode: session.mode, mcpServers: session.mcpServers }));
    return { stopReason: session.cancelled ? 'cancelled' : 'end_turn' };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
