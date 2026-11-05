import * as records from '../../infrastructure/db/repositories/work/index';
import { getTask, listTasks } from '../tasks';
import { listProjects } from '../projects';
import { activeWorkspace } from '../workspaces';
import { getQueue } from '../execution';
import { history, listSessions } from '../agents';
import { getLatestPlan } from '../preparation';
import { taskFinishState } from '../git';
import { computeWorkState } from './state';
import { DomainError } from '../../models/domain-error';
export { computeWorkState } from './state';
export function workEntry(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new DomainError('Task not found', 404);
  const workspace = activeWorkspace(taskId);
  let mrState: string | undefined;
  try { mrState = task.mr_link ? JSON.parse(task.mr_link).state : undefined; } catch { /* Older tasks can have a plain URL. */ }
  const row = records.workEntryCodeReviewItem(taskId) as { n: number };
  const sessions = listSessions(task.project_id).filter(s => s.task_id === task.id);
  // The errand's chat waits for the developer's first message (history is read only for such a fresh chat).
  const awaitingBrief = sessions.some(s => s.role === 'errand' && s.metadata.awaiting_brief && !history(s.id).some(e => e.type === 'user'));
  return { task, workspace, state: computeWorkState({ task, workspace, awaitingBrief,
    queue: getQueue(task.id, task.project_id), sessions,
    plan: getLatestPlan(task.id)?.content, remarks: row.n, finish: taskFinishState(task.id), mrState }) };
}
export function listWork(projectId: string) { return listTasks(projectId).map(task => workEntry(task.id)); }
export function workAttention() {
  return listProjects().map(project => ({ projectId: project.id,
    count: listWork(project.id).filter(entry => entry.state.group === 'attention').length }));
}

export { withWorkStart } from './start';
