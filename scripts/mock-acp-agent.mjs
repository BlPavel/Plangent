import { agent, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
let cancelled = false;
let mcpServers = [];
agent({ name: 'mock' })
  .onRequest('initialize', () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } }))
  .onRequest('session/new', ctx => { mcpServers = ctx.params.mcpServers; return { sessionId: 'mock-session', modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] } }; })
  .onRequest('session/load', () => ({}))
  .onRequest('session/set_mode', () => ({}))
  .onNotification('session/cancel', () => { cancelled = true; })
  .onRequest('session/prompt', async ctx => {
    cancelled = false;
    const text = ctx.params.prompt.map(p => p.text ?? '').join('');
    if (text === 'permission') {
      await ctx.client.request('session/request_permission', { sessionId: 'mock-session', toolCall: { toolCallId: 't', title: 'npm test', kind: 'execute' }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Allow' }, { optionId: 'no', kind: 'reject_once', name: 'Reject' }] });
    }
    for (const chunk of ['hello ', 'world']) {
      await ctx.client.notify('session/update', { sessionId: 'mock-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } });
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    if (text.includes('complete_step tool') || text.includes('finish with submit_review')) {
      const mcp = mcpServers.find(s => s.name === 'plangent');
      const name = text.includes('finish with submit_review') ? 'submit_review' : 'complete_step';
      const response = await fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...Object.fromEntries(mcp.headers.map(h => [h.name, h.value])) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: name === 'submit_review' ? { verdict: 'approved' } : { summary: 'Done' } } }) });
      const result = await response.json();
      if (!response.ok || result.error || result.result?.isError) throw new Error(JSON.stringify(result));
    }
    return { stopReason: cancelled ? 'cancelled' : 'end_turn' };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
