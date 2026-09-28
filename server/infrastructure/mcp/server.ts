import { Router } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@agentclientprotocol/sdk';
import { getSession, addEvent, updateSession } from '../../core/agent-sessions/sessions';
import type { AgentSession } from '../../core/agent-sessions/types';
import { sessionSignals } from '../../core/agent-sessions/acp-host';
import { getDb } from '../db/schema';
import { getLatestPlan } from '../../core/orchestration/plans';
import path from 'path';

const tokens = new Map<string, string>();
export function sessionMcpConfig(session: AgentSession, http: boolean): McpServer[] {
  const token = randomBytes(32).toString('hex');
  tokens.set(token, session.id);
  const url = `${process.env.PLANGENT_URL ?? 'http://127.0.0.1:3001'}/mcp`;
  if (http) return [{ type: 'http', name: 'plangent', url, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }];
  return [{ name: 'plangent', command: process.execPath, args: [path.join(__dirname, 'stdio-proxy.cjs')],
    env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }, { name: 'PLANGENT_MCP_URL', value: url }, { name: 'PLANGENT_MCP_TOKEN', value: token }] }];
}
const tools = {
  complete_step: { description: 'Finish all assigned steps with a summary.', fields: { summary: { type: 'string' } } },
  request_help: { description: 'Ask the developer for help.', fields: { question: { type: 'string' } } },
  report_progress: { description: 'Report progress.', fields: { note: { type: 'string' } } },
  get_review_context: { description: 'Get assigned plan and executor context.', fields: {} },
  add_finding: { description: 'Report a review finding.', fields: { file: { type: 'string' }, line: { type: 'integer', minimum: 1 }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, message: { type: 'string' } } },
  submit_review: { description: 'Submit review verdict.', fields: { verdict: { type: 'string', enum: ['approved', 'changes_requested'] } } },
};
function allowed(session: AgentSession): (keyof typeof tools)[] {
  if (session.role === 'executor') return session.policy === 'read-only' ? ['request_help', 'report_progress'] : ['complete_step', 'request_help', 'report_progress'];
  if (session.role === 'reviewer') return ['get_review_context', 'add_finding', 'submit_review'];
  return [];
}
export const mcpRouter = Router();
mcpRouter.post('/', async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const id = tokens.get(token);
  if (!id) return res.status(401).json({ error: 'Unauthorized' });
  const server = new Server({ name: 'Plangent', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allowed(getSession(id)).map(name => ({ name, description: tools[name].description,
    inputSchema: { type: 'object' as const, properties: tools[name].fields, required: Object.keys(tools[name].fields), additionalProperties: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const session = getSession(id);
    const name = request.params.name as keyof typeof tools;
    if (!allowed(session).includes(name)) throw new Error('Tool not allowed for this role');
    if (!['thinking', 'waiting'].includes(session.status)) throw new Error('Session has no active turn');
    const args = request.params.arguments ?? {};
    for (const field of Object.keys(tools[name].fields)) {
      if (field === 'line' ? !Number.isInteger(args[field]) || Number(args[field]) < 1 : typeof args[field] !== 'string' || !String(args[field]).trim()) throw new Error(`Invalid ${field}`);
    }
    if (name === 'complete_step') { updateSession(id, { status: 'complete', reason: String(args.summary) }); sessionSignals.emit('complete', id, args.summary); }
    if (name === 'request_help') { updateSession(id, { status: 'waiting', reason: String(args.question) }); sessionSignals.emit('help', id, args.question); }
    if (name === 'add_finding') {
      if (!['low', 'medium', 'high', 'critical'].includes(String(args.severity))) throw new Error('Invalid severity');
      getDb().prepare('INSERT INTO review_findings(id,session_id,file,line,severity,message) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), id, args.file, args.line, args.severity, args.message);
    }
    if (name === 'submit_review') {
      if (!['approved', 'changes_requested'].includes(String(args.verdict))) throw new Error('Invalid verdict');
      updateSession(id, { status: 'complete', reason: String(args.verdict) }); sessionSignals.emit('review', id, args.verdict);
    }
    addEvent(id, name, args);
    const result = name === 'get_review_context' ? { steps: session.step_ids, plan: session.task_id ? getLatestPlan(session.task_id)?.content : '', context: session.metadata.reviewContext } : { ok: true };
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (e) { if (!res.headersSent) res.status(500).json({ error: String(e) }); }
});
