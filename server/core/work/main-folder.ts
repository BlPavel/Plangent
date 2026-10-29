import { listTasks } from '../tasks';
import { activeWorkspace } from '../workspaces/store';
import type { Task } from '../../models';

/** The open work that already runs in the project's main folder: only one work at a time may change it. */
export function mainFolderWork(projectId: string, exceptTaskId?: string): Task | null {
  return listTasks(projectId).find(task => task.id !== exceptTaskId && !task.closed_at && task.status !== 'done'
    && !!task.base_commit && !activeWorkspace(task.id)) ?? null;
}
