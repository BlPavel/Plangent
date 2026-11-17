import { agentPreferences } from '../agents';
import type { ErrandInput } from '@contracts';
export type { ErrandPlace, ErrandInput } from '@contracts';
import { createTask, getTask, updateTask } from '../tasks';
import { getProject } from '../projects';
import { effectiveGitSettings } from '../settings';
import { selectAgent } from '../agents';
import { createAgentSession, getSession, history, updateSession, listSessions } from '../agents';
import { runAgentWork, onAgentEvent } from '../agents';
import { activeWorkspace, ensureWorkspaceSetup, recreateWorkspace } from '../workspaces';
import { broadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
import { optional, prepareWorkPlace, readReviewAgent, readWorkPlace } from './place';
import type { WorkPlace } from './place';
import { withWorkStart } from './start';
import { captureTaskBaseCommit } from '../git';

const BRIEFING = 'You are the agent for a standalone errand; there is no step plan.\n'
  + '- Call complete_step with a report only after the requested work is finished; this marks the errand done and may start automatic review. Discussion, clarification questions and progress reports do not complete the errand. Follow-up requests and review remarks arrive in this chat.\n'
  + '- If a message announces a review round, call get_review and reply through reply_review_item.\n'
  + '- Complete the errand only once. After completion, handle follow-up requests and review remarks normally, including file edits, but never call complete_step again; finish with an ordinary reply.\n'
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
  const session = createAgentSession({ project_id: projectId, task_id: task.id, agent_id: agent.id, role: 'errand',
    model: model || agent.model, policy: policy as 'ask' | 'allow-edits' | 'allow-all' | 'read-only', title: title || externalKey,
    metadata: { pending_place: place, pending_text: text, preparation_pending: true, reasoningEffort: agent.reasoning_effort, briefing: BRIEFING,
      ...(reviewAgentPick ? { review_agent: reviewAgentPick } : {}),
      ...agentPreferences(mode, input.config),
      // The developer writes the request in the chat; until then the work waits for them.
      ...(text ? {} : { awaiting_brief: true }) } });
  await resumeErrandPreparation(task.id, session.id, place);
  return { task: getTask(task.id)!, session: getSession(session.id) };
}

async function resumeErrandPreparation(taskId: string, sessionId: string, place: WorkPlace) {
  return withWorkStart(taskId, async () => {
    const task = getTask(taskId)!, project = getProject(task.project_id)!;
    updateSession(sessionId, { metadata: { ...getSession(sessionId).metadata, preparation_pending: true }, reason: '' });
    try {
      const workspace = activeWorkspace(taskId);
      if (workspace?.status === 'failed') await recreateWorkspace(workspace.id);
      const ready = activeWorkspace(taskId);
      if (ready?.status === 'ready') {
        updateTask(taskId, { branch_name: ready.branch, base_branch: ready.base_branch });
        await captureTaskBaseCommit(taskId);
      } else await prepareWorkPlace(taskId, project, place);
      const text = String(getSession(sessionId).metadata.pending_text ?? '');
      updateSession(sessionId, { metadata: { ...getSession(sessionId).metadata,
        workspace_id: activeWorkspace(taskId)?.id, preparation_pending: false, pending_place: undefined, pending_text: undefined }, reason: '' });
      void ensureWorkspaceSetup(taskId).catch(() => {});
      broadcast({ type: 'task_updated', taskId, projectId: project.id });
      void (text ? runAgentWork(sessionId, [{ type: 'text', text }]) : runAgentWork(sessionId))
        .catch(error => updateSession(sessionId, { status: 'error', reason: String(error) }));
    } catch (error) {
      updateSession(sessionId, { status: 'error', reason: activeWorkspace(taskId)?.error || String(error) });
      broadcast({ type: 'task_updated', taskId, projectId: project.id });
      throw error;
    }
  });
}

/** Retry the same work and agent choices; legacy stranded errands have neither a folder nor a session. */
export async function retryErrandPreparation(taskId: string) {
  const task = getTask(taskId), project = task && getProject(task.project_id);
  if (!task || !project || task.kind !== 'errand' || task.closed_at || task.status === 'done') throw new DomainError('Open errand not found', 404);
  let session = listSessions(project.id).find(s => s.task_id === taskId && s.role === 'errand');
  if (session && !session.metadata.preparation_pending) throw new DomainError('Errand is already prepared', 409);
  if (!session) {
    if (task.base_commit) throw new DomainError('Errand is already prepared', 409);
    const agent = selectAgent(project.id, {});
    if (!agent) throw new DomainError('Select an agent');
    const workspace = activeWorkspace(taskId);
    const place: WorkPlace = { place: 'new', branch: '', branchName: workspace?.branch || task.branch_name || '',
      baseBranch: workspace?.base_branch || task.base_branch || '' };
    session = createAgentSession({ project_id: project.id, task_id: taskId, agent_id: agent.id, role: 'errand',
      model: agent.model, policy: 'allow-all', title: task.title || task.key,
      metadata: { briefing: BRIEFING, reasoningEffort: agent.reasoning_effort, preparation_pending: true, pending_place: place,
        ...(!task.description ? { awaiting_brief: true } : {}) } });
  }
  await resumeErrandPreparation(taskId, session.id, session.metadata.pending_place as WorkPlace);
  return getTask(taskId)!;
}
onAgentEvent('turn_end', (id: string) => {
  const session = getSession(id), task = session.task_id && getTask(session.task_id);
  if (session.role !== 'errand' || !task || session.status !== 'complete') return;
  const events = history(id), ended = events.filter(e => e.type === 'turn_end').at(-1);
  if (!ended || ended.payload.stopReason === 'cancelled') return;
  // Only complete_step completes an errand. Wait for its turn to finish before starting the one automatic review.
  if (session.metadata.work_done || session.metadata.auto_review_turn) return;
  updateSession(id, { metadata: { ...session.metadata, work_done: true } });
  if (!task.auto_review) return;
  void import('../review').then(module => module.codeTaskReview).then(m => m.launchIndependentReview(task.id))
    .catch(error => updateSession(id, { reason: session.reason + '\nРевью не запущено: ' + String(error) }));
});
