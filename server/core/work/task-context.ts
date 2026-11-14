import { listSessions } from '../agents';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getLatestPlan, analysisToolContext } from '../preparation';
import { repositoryInfo, taskWorktreeChanges } from '../../infrastructure/git/read';
import { rootForTask } from '../workspaces';
import { DomainError } from '../../models/domain-error';

/**
 * What the task's follow-up agent reads on demand (`get_task_context`): the task, its plan, analysis,
 * the executors' reports and the files changed since the task began. The queue and the executors' chats stay out.
 */
export async function taskContextFor(taskId: string) {
  const task = getTask(taskId), project = task && getProject(task.project_id);
  if (!task || !project) throw new DomainError('Task not found', 404);
  const repository = await repositoryInfo(rootForTask(taskId));
  const changes = repository && task.base_commit ? await taskWorktreeChanges(rootForTask(taskId), task.base_commit) : null;
  return {
    task, plan: getLatestPlan(taskId)?.content ?? '', analysis: analysisToolContext(taskId, project.repo_path, task.key),
    executor_reports: listSessions(project.id).filter(s => s.task_id === taskId && s.role === 'executor').reverse()
      .map(s => ({ steps: s.step_ids, status: s.status, summary: s.reason })),
    changes,
  };
}
