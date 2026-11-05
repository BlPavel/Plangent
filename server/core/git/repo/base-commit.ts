import { rootForTask } from '../../workspaces';
import { repositoryInfo } from '../../../infrastructure/git/read';
import { getTask } from '../../tasks';
import { getProject } from '../../projects';
import { saveTaskBaseCommit } from '../../../infrastructure/db/repositories/git/tasks';
import { broadcast } from '../../shared';

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
  saveTaskBaseCommit(taskId, info.head, reset);
  broadcast({ type: 'task_updated', taskId, projectId: task.project_id });
  return getTask(taskId)!;
}
