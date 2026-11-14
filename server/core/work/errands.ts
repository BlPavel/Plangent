import { agentPreferences } from '../agents';
import type { ErrandInput } from '@contracts';
export type { ErrandPlace, ErrandInput } from '@contracts';
import { createTask, getTask, updateTask } from '../tasks';
import { getProject } from '../projects';
import { effectiveGitSettings } from '../settings';
import { selectAgent } from '../agents';
import { createAgentSession, getSession, history, updateSession } from '../agents';
import { runAgentWork, onAgentEvent } from '../agents';
import { activeWorkspace, ensureWorkspaceSetup } from '../workspaces';
import { broadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
import { optional, prepareWorkPlace, readReviewAgent, readWorkPlace } from './place';

const BRIEFING = 'You are the agent for a standalone errand; there is no step plan.\n'
  + '- Complete the request, then call complete_step with a report. Follow-up requests and review remarks arrive in this chat.\n'
  + '- If a message announces a review round, call get_review and reply through reply_review_item.\n'
  + '- If the work needs a plan, suggest once before editing that the developer use the “⋯” menu and “Добавить план”. Do not suggest it again if they decline or you have started editing.\n'
  + '- Respond in the developer’s language, Russian by default.';
export async function createErrand(projectId: string, input: ErrandInput, created?: (task: import('../../models').Task) => void) {
  const project = getProject(projectId), text = optional(input.text, 'text');
  const agent = selectAgent(projectId, { explicit: input.agent_id });
  if (!project || project.kind === 'source') throw new DomainError('Project not found', 404);
  const title = optional(input.title, 'title') || text.slice(0, 100), externalKey = optional(input.external_key, 'external_key');
  if (!agent) throw new DomainError('Выберите агента');
  if ((!title && !externalKey) || text.length > 100000 || title.length > 300 || externalKey.length > 100) throw new DomainError('Укажите номер задачи или описание');
  const policy = input.policy ?? 'allow-all';
  if (!['ask', 'allow-edits', 'allow-all', 'read-only'].includes(policy)) throw new DomainError('Invalid policy');
  if (input.auto_review !== undefined && typeof input.auto_review !== 'boolean') throw new DomainError('Invalid auto_review');
  const model = optional(input.model, 'model'), mode = optional(input.mode, 'mode');
  const reviewAgentPick = readReviewAgent(input.review_agent);
  const place = await readWorkPlace(project, input);
  const task = createTask({ project_id: projectId, kind: 'errand', title, external_key: externalKey || null, description: text || undefined,
    auto_review: input.auto_review ?? effectiveGitSettings(projectId).values.auto_review, review_agent: reviewAgentPick ?? null });
  updateTask(task.id, { status: 'in_progress' });
  broadcast({ type: 'task_updated', taskId: task.id, projectId });
  created?.(getTask(task.id)!);
  await prepareWorkPlace(task.id, project, place);
  // The work starts now: prepare the folder in the background while the agent connects; its commands wait for it.
  void ensureWorkspaceSetup(task.id).catch(() => {});
  const session = createAgentSession({ project_id: projectId, task_id: task.id, agent_id: agent.id, role: 'errand',
    model: model || agent.model, policy: policy as 'ask' | 'allow-edits' | 'allow-all' | 'read-only', title: title || externalKey,
    metadata: { workspace_id: activeWorkspace(task.id)?.id, reasoningEffort: agent.reasoning_effort, briefing: BRIEFING,
      ...(reviewAgentPick ? { review_agent: reviewAgentPick } : {}),
      ...agentPreferences(mode, input.config),
      // The developer writes the request in the chat; until then the work waits for them.
      ...(text ? {} : { awaiting_brief: true }) } });
  broadcast({ type: 'task_updated', taskId: task.id, projectId });
  if (text) void runAgentWork(session.id, [{ type: 'text', text }]).catch(error => updateSession(session.id, { status: 'error', reason: String(error) }));
  // Connecting to the agent takes a while: it happens while the developer writes the request.
  else void runAgentWork(session.id).catch(() => {});
  return { task: getTask(task.id)!, session: getSession(session.id) };
}
onAgentEvent('turn_end', (id: string) => {
  const session = getSession(id), task = session.task_id && getTask(session.task_id);
  if (session.role !== 'errand' || !task || !['ready', 'complete'].includes(session.status)) return;
  const events = history(id), ended = events.filter(e => e.type === 'turn_end').at(-1);
  if (!ended || ended.payload.stopReason === 'cancelled') return;
  if (session.status === 'ready') {
    const lastUser = events.filter(e => e.type === 'user').at(-1)?.seq ?? 0;
    const summary = events.filter(e => e.type === 'assistant' && e.seq > lastUser).map(e => String(e.payload.text ?? '')).join('');
    updateSession(id, { status: 'complete', reason: summary.slice(-20000) });
  }
  // The automatic review runs once, after the agent's first finished turn; later turns are the developer's follow-ups.
  if (session.metadata.work_done || session.metadata.auto_review_turn) return;
  updateSession(id, { metadata: { ...session.metadata, work_done: true } });
  if (!task.auto_review) return;
  void import('../review').then(module => module.codeTaskReview).then(m => m.launchIndependentReview(task.id))
    .catch(error => updateSession(id, { reason: session.reason + '\nРевью не запущено: ' + String(error) }));
});
