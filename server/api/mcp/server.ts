import { Router } from 'express';
import { randomBytes } from 'crypto';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@agentclientprotocol/sdk';
import { getSession, addEvent } from '../../core/agents';
import { getProject } from '../../core/projects';
import type { AgentSession } from '../../core/agents';
import { getFinish } from '../../core/git/finish';
import { tools, type PlangentTool } from './tools';
import { configureApplicationTools, configureCommandTool } from '../../core/agents';
import { isPlangentToolCall } from './plangent-tools';

configureApplicationTools(isPlangentToolCall);
configureCommandTool(session => allowed(session).includes('run_command'));
const tokens = new Map<string, string>();
export function sessionMcpConfig(session: AgentSession, http: boolean): McpServer[] {
  const token = randomBytes(32).toString('hex');
  tokens.set(token, session.id);
  const url = `${process.env.PLANGENT_URL ?? 'http://127.0.0.1:3001'}/mcp`;
  if (http) return [{ type: 'http', name: 'plangent', url, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }];
  return [{ name: 'plangent', command: process.execPath, args: [path.join(__dirname, 'stdio-proxy.cjs')],
    env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }, { name: 'PLANGENT_MCP_URL', value: url }, { name: 'PLANGENT_MCP_TOKEN', value: token }] }];
}

function finishScenario(session: AgentSession) {
  const id = session.metadata.finish_id;
  try { return typeof id === 'string' ? getFinish(id).scenario : null; } catch { return null; }
}

export function allowed(session: AgentSession): PlangentTool[] {
  const profile = session.role === 'task-reviewer' ? session.role : session.metadata.branch_review ? 'branch-review'
    : session.role === 'executor' && session.policy === 'read-only' ? 'executor-readonly'
    : session.role === 'committer' && finishScenario(session) === 'full' ? 'committer-full' : session.role;
  return (Object.keys(tools) as PlangentTool[]).filter(name => profile in tools[name].roles && (name !== 'git_action' || !!session.project_id && !session.metadata.mr_private && getProject(session.project_id)?.kind === 'project')
    && (!['run_command', 'command_output'].includes(name) || !session.metadata.mr_private))
    .sort((a, b) => tools[a].roles[profile] - tools[b].roles[profile]);
}
export async function callTool(id: string, name: string, args: Record<string, unknown>) {
  const session = getSession(id);
  if (!allowed(session).includes(name as PlangentTool)) throw new Error('Tool not allowed for this role');
  if (!['thinking', 'waiting'].includes(session.status)) throw new Error('Session has no active turn');
  const tool = tools[name as PlangentTool];
  for (const field of tool.validateStrings) {
    if (field === 'line' ? !Number.isInteger(args[field]) || Number(args[field]) < 1 : typeof args[field] !== 'string' || !String(args[field]).trim()) throw new Error(`Invalid ${field}`);
  }
  try {
    const result = await tool.handle(session, args, (event, payload) => addEvent(id, event, payload));
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
  }
}
export const mcpRouter = Router();
mcpRouter.post('/', async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const id = tokens.get(token);
  if (!id) return res.status(401).json({ error: 'Unauthorized' });
  const server = new Server({ name: 'Plangent', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allowed(getSession(id)).map(name => ({ name, description: tools[name].description,
    inputSchema: { type: 'object' as const, properties: tools[name].fields, required: tools[name].required, additionalProperties: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => callTool(id, request.params.name, request.params.arguments ?? {}));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (e) { if (!res.headersSent) res.status(500).json({ error: String(e) }); }
});
