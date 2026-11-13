import { agentPreferences } from '../agents';
import type { ErrandPlace, ErrandInput } from '@contracts';
export type { ErrandPlace, ErrandInput } from '@contracts';
import { createTask, getTask, updateTask } from '../tasks';
import { getProject } from '../projects';
import { effectiveGitSettings } from '../settings';
import { selectAgent } from '../agents';
import { createAgentSession, getSession, history, updateSession } from '../agents';
import { runAgentWork, onAgentEvent } from '../agents';
import { prepareWork } from './start';
import { activeWorkspace, createWorkspace, assertTaskWorkspaceReady } from '../workspaces';
import { captureTaskBaseCommit } from '../git';
import { repositoryInfo } from '../../infrastructure/git/read';
import { broadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
import { mainFolderWork } from './main-folder';

/**
 * Where the errand works: `new` — its own folder on a new branch from `base_branch`; `existing` — its own folder
 * on the developer's `branch` (or the main folder when that branch is open there); `main` — the project's main folder.
 */


const BRIEFING = 'You are the agent for a standalone errand; there is no step plan.\n'
  + '- Complete the request, then call complete_step with a report. Follow-up requests and review remarks arrive in this chat.\n'
  + '- If a message announces a review round, call get_review and reply through reply_review_item.\n'
  + '- If the work needs a plan, suggest once before editing that the developer use the “⋯” menu and “Добавить план”. Do not suggest it again if they decline or you have started editing.\n'
  + '- Respond in the developer’s language, Russian by default.';
const optional = (value: unknown, name: string) => {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new DomainError('Invalid ' + name);
  return typeof value === 'string' ? value.trim() : '';
};
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
  const reviewPick = input.review_agent;
  if (reviewPick !== undefined && (!reviewPick || typeof reviewPick !== 'object' || typeof reviewPick.agent_id !== 'string')) throw new DomainError('Invalid review_agent');
  const reviewAgentPick = reviewPick?.agent_id ? { agent_id: reviewPick.agent_id, model: optional(reviewPick.model, 'review model'), effort: optional(reviewPick.effort, 'review effort') } : undefined;
  const baseBranch = optional(input.base_branch, 'base_branch').replace(/^origin\//, ''), branchName = optional(input.branch_name, 'branch_name');
  let place: ErrandPlace = input.place ?? 'new';
  const branch = optional(input.branch, 'branch').replace(/^origin\//, '');
  if (!['new', 'existing', 'main'].includes(place)) throw new DomainError('Invalid place');
  if (place === 'existing' && !branch) throw new DomainError('Выберите ветку');
  // Groups work in their projects' main folders; a branch already open in the main folder is worked on there.
  if (project.kind !== 'project') place = 'main';
  else if (place === 'existing' && (await repositoryInfo(project.repo_path))?.branch === branch) place = 'main';
  if (place === 'main' && project.kind === 'project') {
    const busy = mainFolderWork(projectId);
    if (busy) throw new DomainError('В основной папке уже идёт работа «' + (busy.title || busy.external_key || busy.key) + '». Закройте её или выберите отдельную ветку.', 409);
  }
  const task = createTask({ project_id: projectId, kind: 'errand', title, external_key: externalKey || null, description: text || undefined,
    auto_review: input.auto_review ?? effectiveGitSettings(projectId).values.auto_review });
  updateTask(task.id, { status: 'in_progress' });
  broadcast({ type: 'task_updated', taskId: task.id, projectId });
  created?.(getTask(task.id)!);
  // A failed preparation remains visible and can be inspected/retried; never start in the main folder on failure.
  try {
    if (place === 'new') await prepareWork(task.id, { base_branch: baseBranch, branch_name: branchName });
    else if (place === 'existing') {
      const base = baseBranch || effectiveGitSettings(projectId).values.base_branch || branch;
      await createWorkspace(task.id, { branch, base });
      assertTaskWorkspaceReady(task.id);
      updateTask(task.id, { branch_name: branch, base_branch: base });
    } else if (project.kind === 'project') updateTask(task.id, { branch_name: (await repositoryInfo(project.repo_path))?.branch ?? undefined });
    await captureTaskBaseCommit(task.id);
  } catch (error) { broadcast({ type: 'task_updated', taskId: task.id, projectId }); throw error; }
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
