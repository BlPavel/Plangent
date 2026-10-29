import { rootForTask } from '../workspaces/roots';
import { repositoryInfo } from '../code/git';
import { getTask } from './index';
import { getProject } from '../projects';
import { getDb } from '../../infrastructure/db/schema';
import { broadcast } from '../shared/events';

/** Capture HEAD once; only an explicit developer action can move the task baseline. */
export async function captureTaskBaseCommit(taskId: string, reset = false) {
  const task = getTask(taskId);
  if (!task) throw new Error('Задача не найдена');
  if (task.base_commit && !reset) return task;
  const project = getProject(task.project_id);
  const info = project ? await repositoryInfo(rootForTask(taskId)) : null;
  if (!info?.head) {
    if (reset) throw new Error('Нет текущего коммита репозитория');
    return task;
  }
  getDb().prepare(reset ? 'UPDATE tasks SET base_commit=? WHERE id=?'
    : "UPDATE tasks SET base_commit=? WHERE id=? AND (base_commit IS NULL OR base_commit='')").run(info.head, taskId);
  broadcast({ type: 'task_updated', taskId, projectId: task.project_id });
  return getTask(taskId)!;
}
