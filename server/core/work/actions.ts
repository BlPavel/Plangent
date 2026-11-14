import * as records from '../../infrastructure/db/repositories/work/actions';
import { getTask, updateTask } from '../tasks';
import { activeWorkspace, createWorkspace, ensureWorkspaceSetup, removeWorkspace, removalBlockers, WorkspaceRemovalError, getWorkspace } from '../workspaces';
import { withWorkStart } from './start';
import { getQueue, isFrozen } from '../execution';
import { listSessions, updateSession } from '../agents';
import { closeSession } from '../agents';
import { getOrchestrator } from '../execution';
import { taskMrs } from '../git';
import { activeFinish } from '../git';
import { createErrand, type ErrandInput } from './errands';
import { broadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
import { initTaskFile } from '../tasks';

function taskContext(id: string) {
  const task = getTask(id);
  if (!task) throw new DomainError('Task not found', 404);
  return task;
}
function changed(id: string) {
  const task = taskContext(id);
  broadcast({ type: 'task_updated', taskId: id, projectId: task.project_id });
  return task;
}
function assertIdle(id: string) {
  const task = taskContext(id), workspace = activeWorkspace(id);
  if (isFrozen(getQueue(id, task.project_id)) || listSessions(task.project_id).some(s => s.task_id === id && ['thinking', 'starting', 'waiting'].includes(s.status))
    || workspace && activeFinish(task.project_id, workspace.id)) throw new DomainError('Сначала остановите работу агента или Завершение', 409);
}
export async function closeWork(id: string, input: { discard?: boolean } = {}) {
  return withWorkStart(id, async () => {
    const task = taskContext(id);
    assertIdle(id);
    const workspace = activeWorkspace(id);
    if (workspace) {
      const blockers = await removalBlockers(workspace.id);
      if (!input.discard && (blockers.files.length || blockers.commits.length)) throw new WorkspaceRemovalError(blockers);
      await removeWorkspace(workspace.id, { discard: input.discard, keepBranch: true });
    }
    updateTask(id, { status: 'done', closed_at: task.closed_at ?? new Date().toISOString(), close_reason: 'done' });
    return changed(id);
  });
}
export async function reopenWork(id: string) {
  return withWorkStart(id, async () => {
    const task = taskContext(id);
    if (!task.closed_at && task.status !== 'done') throw new DomainError('Работа уже открыта', 409);
    if (task.mr_link && (await taskMrs().refresh(task.project_id, id))?.state === 'merged')
      throw new DomainError('МР влит — создайте поручение по этой работе', 409);
    const previous = records.reopenWorkWorkspaces(id) as { id: string } | undefined;
    let workspace = activeWorkspace(id);
    if (!workspace && previous) {
      const old = getWorkspace(previous.id);
      workspace = await createWorkspace(id, { branch: old.branch, base: old.base_branch });
      if (old.setup_done) void ensureWorkspaceSetup(id).catch(() => {});
    }
    if (workspace && workspace.status !== 'ready') throw new DomainError(workspace.error || 'Рабочее место недоступно', 409);
    if (workspace) for (const session of listSessions(task.project_id).filter(s => s.task_id === id))
      updateSession(session.id, { metadata: { ...session.metadata, workspace_id: workspace.id } });
    updateTask(id, { status: 'in_progress', closed_at: null, close_reason: null });
    if (!workspace) initTaskFile(getTask(id)!);
    return changed(id);
  });
}
export async function cancelErrand(id: string, mode: 'discard' | 'keep') {
  return withWorkStart(id, async () => {
    const task = taskContext(id);
    if (task.kind !== 'errand' || !['discard', 'keep'].includes(mode)) throw new DomainError('Выберите способ отмены поручения');
    const currentWorkspace = activeWorkspace(id);
    if (currentWorkspace && activeFinish(task.project_id, currentWorkspace.id)) throw new DomainError('Сначала завершите Завершение', 409);
    await getOrchestrator(id)?.stop('Поручение отменено');
    for (const session of listSessions(task.project_id).filter(s => s.task_id === id)) await closeSession(session.id);
    const workspace = activeWorkspace(id);
    if (workspace && mode === 'discard') await removeWorkspace(workspace.id, { discard: true });
    updateTask(id, { status: 'done', closed_at: new Date().toISOString(), close_reason: 'cancelled' });
    return changed(id);
  });
}
export async function addPlan(id: string) {
  return withWorkStart(id, async () => {
    const task = taskContext(id);
    if (task.kind !== 'errand' || task.closed_at) throw new DomainError('Нужно открытое поручение', 409);
    assertIdle(id);
    updateTask(id, { kind: 'task' });
    return changed(id);
  });
}
export async function errandFromWork(id: string, input: ErrandInput) {
  const task = taskContext(id);
  if (typeof input.text !== 'string' || !input.text.trim()) throw new DomainError('Введите текст поручения');
  if (!task.mr_link || (await taskMrs().refresh(task.project_id, id))?.state !== 'merged')
    throw new DomainError('Поручение по этой работе доступно после влития МР', 409);
  const sections = records.errandFromWorkAnalysisSections(id);
  return createErrand(task.project_id, { ...input, text: input.text + '\n\nИсходная работа: ' + task.key + ' ' + (task.title ?? '') + '\n' + JSON.stringify(sections) },
    created => { updateTask(created.id, { origin_task_id: id }); changed(created.id); });
}
