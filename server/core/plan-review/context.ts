import { CodeError } from '../code/files';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getDb } from '../../infrastructure/db/schema';

export function reviewTask(projectId: string, taskId: string) {
  const task = getTask(taskId), project = getProject(projectId);
  if (!task || !project || task.project_id !== projectId) throw new CodeError('Task not found', 404);
  return { task, project };
}
export function assertUnfrozen(taskId: string) {
  if (!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_queues'").get()) return;
  const row = getDb().prepare('SELECT data FROM task_queues WHERE task_id=?').get(taskId) as { data: string } | undefined;
  if (row && ['running', 'paused'].includes(JSON.parse(row.data).status)) throw new CodeError('Plan is frozen while the queue is running', 409);
}
