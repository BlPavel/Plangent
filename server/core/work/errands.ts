import { createTask, getTask, updateTask } from '../tasks';
import { getProject, effectiveGitSettings } from '../projects';
import { getAgent } from '../agents';
import { createSession, getSession, history, updateSession } from '../agent-sessions/sessions';
import { sendPrompt, sessionSignals, startSession } from '../agent-sessions/acp-host';
import { prepareWork } from './start';
import { activeWorkspace, createWorkspace, assertTaskWorkspaceReady } from '../workspaces';
import { captureTaskBaseCommit } from '../tasks/base-commit';
import { repositoryInfo } from '../code/git';
import { broadcast } from '../shared/events';
import { CodeError } from '../code/files';
import { mainFolderWork } from './main-folder';

/**
 * Where the errand works: `new` — its own folder on a new branch from `base_branch`; `existing` — its own folder
 * on the developer's `branch` (or the main folder when that branch is open there); `main` — the project's main folder.
 */
export type ErrandPlace = 'new' | 'existing' | 'main';
export interface ErrandInput {
  /** Описание: what the developer sees in the list; the details go to the chat. */
  title?: string; external_key?: string;
  /** A ready request (e.g. «Поручение по этой работе»): sent to the agent right away. */
  text?: string;
  agent_id?: string; model?: string; policy?: string; mode?: string; config?: Record<string, string>; auto_review?: boolean;
  place?: ErrandPlace; base_branch?: string; branch_name?: string; branch?: string;
}
const BRIEFING = 'Выполни поручение пользователя. Плана шагов нет. После выполнения вызови complete_step с отчётом. Замечания и дальнейшие доработки приходят в этот же чат. Если сообщение сообщает о раунде ревью, вызови get_review и отвечай в замечаниях через reply_review_item.\n'
  + 'Если, изучив код, ты решишь, что работа слишком большая для поручения и ей нужен план, до первых правок один раз предложи пользователю превратить поручение в задачу с планом (меню «⋯» на странице поручения — «Добавить план»). Если пользователь отказался или ты уже начал вносить правки, больше это не предлагай.';
const optional = (value: unknown, name: string) => {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new CodeError('Invalid ' + name);
  return typeof value === 'string' ? value.trim() : '';
};
export async function createErrand(projectId: string, input: ErrandInput, created?: (task: import('../../models').Task) => void) {
  const project = getProject(projectId), text = optional(input.text, 'text');
  const agent = getAgent(input.agent_id || project?.default_agent_id || '');
  if (!project || project.kind === 'source') throw new CodeError('Project not found', 404);
  const title = optional(input.title, 'title') || text.slice(0, 100), externalKey = optional(input.external_key, 'external_key');
  if (!agent) throw new CodeError('Выберите агента');
  if ((!title && !externalKey) || text.length > 100000 || title.length > 300 || externalKey.length > 100) throw new CodeError('Укажите номер задачи или описание');
  const policy = input.policy ?? 'allow-all';
  if (!['ask', 'allow-edits', 'allow-all', 'read-only'].includes(policy)) throw new CodeError('Invalid policy');
  if (input.auto_review !== undefined && typeof input.auto_review !== 'boolean') throw new CodeError('Invalid auto_review');
  const model = optional(input.model, 'model'), mode = optional(input.mode, 'mode');
  const baseBranch = optional(input.base_branch, 'base_branch').replace(/^origin\//, ''), branchName = optional(input.branch_name, 'branch_name');
  let place: ErrandPlace = input.place ?? 'new';
  const branch = optional(input.branch, 'branch').replace(/^origin\//, '');
  if (!['new', 'existing', 'main'].includes(place)) throw new CodeError('Invalid place');
  if (place === 'existing' && !branch) throw new CodeError('Выберите ветку');
  // Groups work in their projects' main folders; a branch already open in the main folder is worked on there.
  if (project.kind !== 'project') place = 'main';
  else if (place === 'existing' && (await repositoryInfo(project.repo_path))?.branch === branch) place = 'main';
  if (place === 'main' && project.kind === 'project') {
    const busy = mainFolderWork(projectId);
    if (busy) throw new CodeError('В основной папке уже идёт работа «' + (busy.title || busy.external_key || busy.key) + '». Закройте её или выберите отдельную ветку.', 409);
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
  const session = createSession({ project_id: projectId, task_id: task.id, agent_id: agent.id, role: 'errand',
    model: model || agent.model, policy: policy as 'ask' | 'allow-edits' | 'allow-all' | 'read-only', title: title || externalKey,
    metadata: { workspace_id: activeWorkspace(task.id)?.id, reasoningEffort: agent.reasoning_effort, briefing: BRIEFING,
      ...(mode ? { preferredMode: mode } : {}),
      ...(input.config && typeof input.config === 'object' ? { preferredConfig: Object.fromEntries(Object.entries(input.config).map(([k, v]) => [k, String(v)])) } : {}),
      // The developer writes the request in the chat; until then the work waits for them.
      ...(text ? {} : { awaiting_brief: true }) } });
  broadcast({ type: 'task_updated', taskId: task.id, projectId });
  if (text) void sendPrompt(session.id, [{ type: 'text', text }]).catch(error => updateSession(session.id, { status: 'error', reason: String(error) }));
  // Connecting to the agent takes a while: it happens while the developer writes the request.
  else void startSession(session.id).catch(() => {});
  return { task: getTask(task.id)!, session: getSession(session.id) };
}
sessionSignals.on('turn_end', (id: string) => {
  const session = getSession(id), task = session.task_id && getTask(session.task_id);
  if (session.role !== 'errand' || !task || !['ready', 'complete'].includes(session.status)) return;
  const events = history(id), ended = events.filter(e => e.type === 'turn_end').at(-1);
  if (!ended || ended.payload.stopReason === 'cancelled') return;
  if (session.status === 'ready') {
    const lastUser = events.filter(e => e.type === 'user').at(-1)?.seq ?? 0;
    const summary = events.filter(e => e.type === 'assistant' && e.seq > lastUser).map(e => String(e.payload.text ?? '')).join('');
    updateSession(id, { status: 'complete', reason: summary.slice(-20000) });
  }
  if (!task.auto_review) return;
  const turn = ended.seq;
  if (!turn || session.metadata.auto_review_turn === turn) return;
  updateSession(id, { metadata: { ...session.metadata, auto_review_turn: turn } });
  void import('../orchestration/task-review').then(m => m.launchIndependentReview(task.id, { agent_id: session.agent_id }))
    .catch(error => updateSession(id, { reason: session.reason + '\nРевью не запущено: ' + String(error) }));
});
