import { agent, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
let cancelled = false;
let mcpServers = [];
let workspaceCwd = '';
let currentMode = 'read-only';
function reportedModes() {
  if (!process.argv.includes('--codex-modes')) return {};
  const options = ['read-only', 'workspace-write', 'danger-full-access'].map(value => ({ value, name: value }));
  return {
    ...(!process.argv.includes('--config-only') ? { modes: { currentModeId: currentMode, availableModes: options.map(o => ({ id: o.value, name: o.name })) } } : {}),
    configOptions: [{ id: 'mode', category: 'mode', type: 'select', name: 'Mode', currentValue: currentMode, options }],
  };
}
agent({ name: 'mock' })
  .onRequest('initialize', () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } } }))
  .onRequest('session/new', ctx => { workspaceCwd = ctx.params.cwd; mcpServers = ctx.params.mcpServers; return { sessionId: 'mock-session', modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] }, ...reportedModes(), ...(process.argv.includes('--config-only') ? { modes: undefined } : {}) }; })
  .onRequest('session/load', async ctx => {
    workspaceCwd = ctx.params.cwd;
    if (process.argv.includes('--session-titles')) await ctx.client.notify('session/update', {
      sessionId: ctx.params.sessionId, update: { sessionUpdate: 'session_info_update', title: 'Restored chat title' },
    });
    return reportedModes();
  })
  .onRequest('session/set_mode', ctx => { currentMode = ctx.params.modeId; return {}; })
  .onRequest('session/set_config_option', ctx => { currentMode = ctx.params.value; return { configOptions: reportedModes().configOptions ?? [] }; })
  .onNotification('session/cancel', () => { cancelled = true; })
  .onRequest('session/prompt', async ctx => {
    cancelled = false;
    const text = ctx.params.prompt.map(p => p.text ?? '').join('');
    if (process.argv.includes('--inspect-mode')) {
      await ctx.client.notify('session/update', { sessionId: 'mock-session', update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: currentMode },
      } });
      return { stopReason: 'end_turn' };
    }
    if (process.argv.includes('--hold-task-review') && text.includes('get_task_review_brief')) {
      while (!cancelled) await new Promise(resolve => setTimeout(resolve, 20));
      return { stopReason: 'cancelled' };
    }
    if (process.argv.includes('--inspect-workspace')) {
      await ctx.client.notify('session/update', { sessionId: 'mock-session', update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify({ cwd: workspaceCwd, prompt: ctx.params.prompt }) },
      } });
      return { stopReason: 'end_turn' };
    }
    if (process.argv.includes('--session-titles')) await ctx.client.notify('session/update', {
      sessionId: 'mock-session', update: { sessionUpdate: 'session_info_update', title: text.slice(0, 120) },
    });
    if (text === 'permission') {
      await ctx.client.request('session/request_permission', { sessionId: 'mock-session', toolCall: { toolCallId: 't', title: 'npm test', kind: 'execute' }, options: [{ optionId: 'yes', kind: 'allow_once', name: 'Allow' }, { optionId: 'no', kind: 'reject_once', name: 'Reject' }] });
    }
    for (const chunk of ['hello ', 'world']) {
      await ctx.client.notify('session/update', { sessionId: 'mock-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } });
      if (process.argv.includes('--session-titles')) await ctx.client.notify('session/update', {
        sessionId: 'mock-session', update: { sessionUpdate: 'session_info_update', title: '  Meaningful chat title  ' },
      });
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    if (text.includes('complete_step tool')) {
      const mcp = mcpServers.find(s => s.name === 'plangent');
      const name = 'complete_step';
      const response = await fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...Object.fromEntries(mcp.headers.map(h => [h.name, h.value])) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { summary: 'Done' } } }) });
      const result = await response.json();
      if (!response.ok || result.error || result.result?.isError) throw new Error(JSON.stringify(result));
    }
    return { stopReason: cancelled ? 'cancelled' : 'end_turn' };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
