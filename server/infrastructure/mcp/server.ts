import { Router } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@agentclientprotocol/sdk';
import { getSession, addEvent, updateSession } from '../../core/agent-sessions/sessions';
import type { AgentSession } from '../../core/agent-sessions/types';
import { sessionSignals } from '../../core/agent-sessions/acp-host';
import { plangentTools, type PlangentTool } from '../../core/agent-sessions/plangent-tools';
import { getDb } from '../db/schema';
import { getLatestPlan } from '../../core/orchestration/plans';
import { submitPlan } from '../../core/orchestration/plan-file';
import { getOrchestrator } from '../../core/orchestration/orchestrator';
import { planningToolContext } from '../../core/orchestration/prompts';
import { resolvePlanTemplate } from '../../core/library/plan-template';
import { getTask } from '../../core/tasks';
import { getProject } from '../../core/projects';
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
const tools = plangentTools;
function allowed(session: AgentSession): PlangentTool[] {
  if (session.role === 'executor') return session.policy === 'read-only' ? ['request_help', 'report_progress'] : ['complete_step', 'request_help', 'report_progress'];
  if (session.role === 'reviewer') return ['get_review_context', 'add_finding', 'submit_review'];
  if (session.role === 'planner') return ['get_plan', 'submit_plan'];
  return [];
}
function planTask(session: AgentSession) {
  const task = session.task_id ? getTask(session.task_id) : null;
  const project = getProject(session.project_id);
  if (!task || !project) throw new Error('Task not found');
  return { task, project };
}
function planResult(name: 'get_plan' | 'submit_plan', session: AgentSession, args: Record<string, unknown>): unknown {
  const { task, project } = planTask(session);
  if (name === 'submit_plan') {
    const executing = !!getOrchestrator(task.id);
    const { steps, removed } = submitPlan(task, project.repo_path, String(args.content), !executing);
    return { saved: true, steps, ...(removed.length ? { removedSteps: removed } : {}) };
  }
  return planningToolContext({ projectName: project.name, taskKey: task.key, taskTitle: task.title ?? undefined,
    taskDescription: task.description ?? undefined, planContent: getLatestPlan(task.id)?.content, planTemplate: resolvePlanTemplate(project.id), runHistory: [] });
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
    if (name === 'get_plan' || name === 'submit_plan') {
      // Format problems go back to the agent as a tool error it can fix, not as a protocol failure.
      let result: unknown;
      try { result = planResult(name, session, args); }
      catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
      if (name === 'submit_plan') addEvent(id, name, { summary: `План сохранён: шагов — ${(result as { steps: string[] }).steps.length}` });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
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
