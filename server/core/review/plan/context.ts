import * as queries from '../../../infrastructure/db/repositories/review/plan/context';
import { DomainError } from '../../../models/domain-error';
import { getTask } from '../../tasks';
import { getProject } from '../../projects';

export function reviewTask(projectId: string, taskId: string) {
  const task = getTask(taskId), project = getProject(projectId);
  if (!task || !project || task.project_id !== projectId) throw new DomainError('Task not found', 404);
  return { task, project };
}
export function assertUnfrozen(taskId: string) {
  if (!queries.assertUnfrozenSelectSqliteMaster()) return;
  const row = queries.rowSelectTaskQueues(taskId) as { data: string } | undefined;
  if (row && ['running', 'paused'].includes(JSON.parse(row.data).status)) throw new DomainError('Plan is frozen while the queue is running', 409);
}
