import { brief as planReviewBrief, reviewerOutput } from '../../core/plan-review/reviewer';
import { taskReviewBrief, addTaskRemark, submitTaskReview } from '../../core/orchestration/task-review';
import { items as planReviewItems, reply as planReviewReply } from '../../core/plan-review/planner-transport';
import { finishes, getFinish } from '../../core/finish';
import { reviews } from '../../core/code-reviews/reviews';
import { agentView as branchQuestions, agentReply as branchReply } from '../../core/branch-review/questions';
import { brief as reviewBrief, setOverview as setReviewOverview } from '../../core/branch-review/agent';
import { agentRemark } from '../../core/branch-review/remarks';
import { conflictBrief, reportConflictFile } from '../../core/conflicts';
import { analysisToolContext, saveAnalystSection } from '../../core/orchestration/analysis-context';
import { Router } from 'express';
import { randomBytes } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@agentclientprotocol/sdk';
import { getSession, addEvent, updateSession } from '../../core/agent-sessions/sessions';
import type { AgentSession } from '../../core/agent-sessions/types';
import { sessionSignals } from '../../core/agent-sessions/acp-host';
import { plangentTools, type PlangentTool } from '../../core/agent-sessions/plangent-tools';
import { getLatestPlan } from '../../core/orchestration/plans';
import { submitPlan } from '../../core/orchestration/plan-file';
import { getOrchestrator } from '../../core/orchestration/orchestrator';
import { planningToolContext } from '../../core/orchestration/prompts';
import { resolvePlanTemplate } from '../../core/library/plan-template';
import { getTask } from '../../core/tasks';
import { getProject } from '../../core/projects';
import path from 'path';

import { libraryToolContext, libraryToolItem, proposeLibraryChange, type ProposalInput } from '../../core/library/proposals';

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
function finishScenario(session: AgentSession) {
  const id = session.metadata.finish_id;
  try { return typeof id === 'string' ? getFinish(id).scenario : null; } catch { return null; }
}
export function allowed(session: AgentSession): PlangentTool[] {
  if (session.role === 'task-reviewer') return ['get_task_review_brief', 'add_task_remark', 'submit_task_review', 'request_help', 'report_progress'];
  if (session.metadata.branch_review) return ['get_review_brief', 'get_branch_questions', 'reply_branch_question', 'set_review_overview', 'add_review_remark'];
  if (session.role === 'plan-reviewer') return ['get_plan_review_brief', 'set_plan_review_overview', 'add_plan_remark'];
  if (session.role === 'executor') return session.policy === 'read-only' ? ['request_help', 'report_progress'] : ['complete_step', 'request_help', 'report_progress'];
  if (session.role === 'analyst') return ['get_analysis', 'save_section'];
  if (session.role === 'code-fixer') return ['get_review', 'start_review_item', 'reply_review_item'];
  if (session.role === 'conflict-resolver') return ['get_conflicts', 'report_conflict_file'];
  if (session.role === 'committer') return [...['get_finish_context', 'set_commits', 'finish_commits'] as PlangentTool[], ...(finishScenario(session) === 'full' ? ['set_merge_request' as const] : [])];
  if (session.role === 'librarian') return ['get_library', 'get_library_item', 'propose_library_change'];
  if (session.role === 'planner') return ['get_plan', 'submit_plan', 'get_plan_review_items', 'reply_plan_remark'];
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
    const { steps, removed } = submitPlan(task, project.repo_path, String(args.content), !executing, session.id);
    return { saved: true, steps, ...(removed.length ? { removedSteps: removed } : {}) };
  }
  return planningToolContext({ taskId: task.id, repoPath: project.repo_path, projectName: project.name, taskKey: task.key, taskTitle: task.title ?? undefined,
    taskDescription: task.description ?? undefined, planContent: getLatestPlan(task.id)?.content, planTemplate: resolvePlanTemplate(project.id), runHistory: [] });
}
export const mcpRouter = Router();
mcpRouter.post('/', async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const id = tokens.get(token);
  if (!id) return res.status(401).json({ error: 'Unauthorized' });
  const server = new Server({ name: 'Plangent', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allowed(getSession(id)).map(name => ({ name, description: tools[name].description,
    inputSchema: { type: 'object' as const, properties: tools[name].fields, required: name === 'add_task_remark' ? ['scope', 'kind', 'text'] : name === 'add_plan_remark' ? ['steps', 'kind', 'text'] : name === 'save_section' ? ['title', 'description'] : name === 'reply_review_item' || name === 'reply_branch_question' ? ['id', 'kind', 'text'] : name === 'add_review_remark' ? ['text'] : Object.keys(tools[name].fields), additionalProperties: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const session = getSession(id);
    const name = request.params.name as keyof typeof tools;
    if (!allowed(session).includes(name)) throw new Error('Tool not allowed for this role');
    if (!['thinking', 'waiting'].includes(session.status)) throw new Error('Session has no active turn');
    const args = request.params.arguments ?? {};
    for (const field of ['add_task_remark', 'set_plan_review_overview', 'add_plan_remark', 'save_section', 'propose_library_change', 'reply_review_item', 'set_commits', 'add_review_remark'].includes(name) ? [] : Object.keys(tools[name].fields)) {
      if (field === 'line' ? !Number.isInteger(args[field]) || Number(args[field]) < 1 : typeof args[field] !== 'string' || !String(args[field]).trim()) throw new Error(`Invalid ${field}`);
    }
    if (name === 'get_task_review_brief' || name === 'add_task_remark' || name === 'submit_task_review') {
      try {
        const result = name === 'get_task_review_brief' ? await taskReviewBrief(session)
          : name === 'add_task_remark' ? await addTaskRemark(session, args) : await submitTaskReview(session, args.summary);
        addEvent(id, name, { summary: String(args.text ?? args.summary ?? '').slice(0, 120) });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
    }
    if (['get_plan_review_brief', 'set_plan_review_overview', 'add_plan_remark', 'get_plan_review_items', 'reply_plan_remark'].includes(name)) {
      try {
        const result = name === 'get_plan_review_brief' ? planReviewBrief(session)
          : name === 'get_plan_review_items' ? planReviewItems(session)
          : name === 'reply_plan_remark' ? planReviewReply(session, args) : reviewerOutput(session, name, args);
        addEvent(id, name, { item_id: args.id, summary: String(args.text ?? args.overview ?? '').slice(0, 120) });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
    }
    if (name === 'get_finish_context' || name === 'set_commits' || name === 'finish_commits' || name === 'set_merge_request') {
      try {
        const service = finishes(), runId = service.agentRun(session);
        const result = name === 'get_finish_context' ? await service.context(runId)
          : name === 'set_merge_request' ? await service.setMergeRequest(runId, args.title, args.description)
          : name === 'set_commits' ? await service.setCommits(runId, args.commits, true)
          : await service.finishCommits(runId);
        addEvent(id, name, { finish_id: runId });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
    }
    if (name === 'get_review' || name === 'start_review_item' || name === 'reply_review_item') {
      try {
        const result = name === 'get_review' ? await reviews().getAgentReview(session)
          : name === 'start_review_item' ? reviews().focusItem(session, String(args.id))
          : await reviews().replyItem(session, String(args.id ?? ''), args);
        // The review panel shows permission requests in the card the agent focused on.
        if (name === 'start_review_item') addEvent(id, 'review_focus', { item_id: String(args.id) });
        if (name === 'reply_review_item') addEvent(id, name, { item_id: String(args.id), kind: args.kind, text: args.text });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
    }
    if (name === 'get_conflicts' || name === 'report_conflict_file') {
      try {
        const result = name === 'get_conflicts' ? await conflictBrief(session) : await reportConflictFile(session, args);
        if (name === 'report_conflict_file') addEvent(id, name, { summary: String(args.path) + ': ' + String(args.outcome) });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
    }
    if (name === 'get_branch_questions' || name === 'reply_branch_question') {
      try {
        const result = name === 'get_branch_questions' ? branchQuestions(session) : branchReply(session, String(args.id ?? ''), args);
        if (name === 'reply_branch_question') addEvent(id, name, { item_id: String(args.id), kind: args.kind, text: args.text });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
    }
    if (name === 'get_review_brief' || name === 'set_review_overview' || name === 'add_review_remark') {
      try {
        const result = name === 'get_review_brief' ? await reviewBrief(session) : name === 'set_review_overview' ? await setReviewOverview(session, args.text) : await agentRemark(session, args);
        if (name === 'set_review_overview') addEvent(id, name, { summary: 'Сводка МР сохранена' });
        if (name === 'add_review_remark') addEvent(id, name, { summary: 'Черновик замечания: ' + String(args.text ?? '').slice(0, 120) });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
    }
    if (name === 'get_library' || name === 'get_library_item' || name === 'propose_library_change') {
      try {
        if (name === 'propose_library_change' && (!args.proposal || typeof args.proposal !== 'object' || Array.isArray(args.proposal))) throw new Error('Invalid proposal');
        const result = name === 'get_library' ? libraryToolContext(session.project_id)
          : name === 'get_library_item' ? libraryToolItem(session.project_id, String(args.id))
          : proposeLibraryChange(id, args.proposal as unknown as ProposalInput);
        if (name === 'propose_library_change') {
          const proposal = result as ReturnType<typeof proposeLibraryChange>;
          addEvent(id, name, { summary: proposal.explanation, proposal_id: proposal.id });
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
    }
    if (name === 'complete_step') { updateSession(id, { status: 'complete', reason: String(args.summary) }); sessionSignals.emit('complete', id, args.summary); }
    if (name === 'request_help') { updateSession(id, { status: 'waiting', reason: String(args.question) }); sessionSignals.emit('help', id, args.question); }
    if (name === 'get_analysis' || name === 'save_section') {
      try {
        const { task, project } = planTask(session);
        const section = name === 'save_section' ? saveAnalystSection(task.id, args) : null;
        const result = section ? { saved: true, section: { id: section.id, slug: section.slug, title: section.title, kind: section.kind, author: section.author }, link: '[[' + section.slug + ']]' }
          : analysisToolContext(task.id, project.repo_path, task.key);
        if (section) addEvent(id, name, { summary: 'Раздел анализа сохранён: ' + section.title, link: '[[' + section.slug + ']]' });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }; }
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
    const result = { ok: true };
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (e) { if (!res.headersSent) res.status(500).json({ error: String(e) }); }
});
