import { getDb } from '../../infrastructure/db/schema';
import { getTask, updateTask } from '../tasks';
import { activeWorkspace, createWorkspace, removeWorkspace, removalBlockers, WorkspaceRemovalError, getWorkspace } from '../workspaces';
import { withWorkStart } from './start';
import { getQueue, isFrozen } from '../orchestration/queue';
import { listSessions, updateSession } from '../agent-sessions/sessions';
import { closeSession } from '../agent-sessions/acp-host';
import { getOrchestrator } from '../orchestration/orchestrator';
import { taskMrs } from '../task-mr';
import { activeFinish } from '../finish/store';
import { createErrand, type ErrandInput } from './errands';
import { broadcast } from '../shared/events';
import { CodeError } from '../code/files';

function taskContext(id: string) {
  const task = getTask(id);
  if (!task) throw new CodeError('Task not found', 404);
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
    || workspace && activeFinish(task.project_id, workspace.id)) throw new CodeError('Сначала остановите работу агента или Завершение', 409);
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
    if (!task.closed_at && task.status !== 'done') throw new CodeError('Работа уже открыта', 409);
    if (task.mr_link && (await taskMrs().refresh(task.project_id, id))?.state === 'merged')
      throw new CodeError('МР влит — создайте поручение по этой работе', 409);
    const previous = getDb().prepare('SELECT id FROM workspaces WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(id) as { id: string } | undefined;
    let workspace = activeWorkspace(id);
    if (!workspace && previous) {
      const old = getWorkspace(previous.id);
      workspace = await createWorkspace(id, { branch: old.branch, base: old.base_branch });
    }
    if (workspace && workspace.status !== 'ready') throw new CodeError(workspace.error || 'Рабочее место недоступно', 409);
    if (workspace) for (const session of listSessions(task.project_id).filter(s => s.task_id === id))
      updateSession(session.id, { metadata: { ...session.metadata, workspace_id: workspace.id } });
    updateTask(id, { status: 'in_progress', closed_at: null, close_reason: null });
    return changed(id);
  });
}
export async function cancelErrand(id: string, mode: 'discard' | 'keep') {
  return withWorkStart(id, async () => {
    const task = taskContext(id);
    if (task.kind !== 'errand' || !['discard', 'keep'].includes(mode)) throw new CodeError('Выберите способ отмены поручения');
    const currentWorkspace = activeWorkspace(id);
    if (currentWorkspace && activeFinish(task.project_id, currentWorkspace.id)) throw new CodeError('Сначала завершите Завершение', 409);
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
    if (task.kind !== 'errand' || task.closed_at) throw new CodeError('Нужно открытое поручение', 409);
    assertIdle(id);
    updateTask(id, { kind: 'task' });
    return changed(id);
  });
}
export async function errandFromWork(id: string, input: ErrandInput) {
  const task = taskContext(id);
  if (typeof input.text !== 'string' || !input.text.trim()) throw new CodeError('Введите текст поручения');
  if (!task.mr_link || (await taskMrs().refresh(task.project_id, id))?.state !== 'merged')
    throw new CodeError('Поручение по этой работе доступно после влития МР', 409);
  const sections = getDb().prepare('SELECT title,description FROM analysis_sections WHERE task_id=? ORDER BY position').all(id);
  return createErrand(task.project_id, { ...input, text: input.text + '\n\nИсходная работа: ' + task.key + ' ' + (task.title ?? '') + '\n' + JSON.stringify(sections) },
    created => { updateTask(created.id, { origin_task_id: id }); changed(created.id); });
}
