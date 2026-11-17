import type { PlanTaskInput, Task } from '../../models';
import { createTask, getTask } from '../tasks';
import { getProject } from '../projects';
import { listSessions } from '../agents';
import { broadcast, onBroadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
import { optional, prepareWorkPlace, readReviewAgent, readWorkPlace } from './place';

/** A task with a plan: like an errand it gets its branch at creation; the automatic review is chosen when its execution starts. */
export async function createPlanTask(projectId: string, input: PlanTaskInput, created?: (task: Task) => void) {
  const project = getProject(projectId);
  if (!project || project.kind === 'source') throw new DomainError('Project not found', 404);
  const title = optional(input.title, 'title'), externalKey = optional(input.external_key, 'external_key');
  if ((!title && !externalKey) || title.length > 300 || externalKey.length > 100) throw new DomainError('Укажите номер задачи или описание');
  if (input.auto_review !== undefined && typeof input.auto_review !== 'boolean') throw new DomainError('Invalid auto_review');
  const reviewAgent = readReviewAgent(input.review_agent);
  // Without a place the branch is chosen when the execution starts (a group's work, older clients).
  const place = input.place === undefined ? null : await readWorkPlace(project, input);
  const task = createTask({ project_id: projectId, kind: 'task', title: title || undefined, external_key: externalKey || null,
    auto_review: input.auto_review ?? false, review_agent: reviewAgent ?? null });
  created?.(task);
  if (place) await prepareWorkPlace(task.id, project, place);
  broadcast({ type: 'task_updated', taskId: task.id, projectId });
  return getTask(task.id)!;
}

// The automatic review of a plan runs once, after its queue first finishes without failures, as an errand's after explicit completion.
onBroadcast(event => {
  if (event.type !== 'queue_finished' || event.failed || typeof event.taskId !== 'string') return;
  const task = getTask(event.taskId);
  if (!task || task.kind !== 'task' || !task.auto_review || task.closed_at || task.status === 'done') return;
  if (listSessions(task.project_id).some(s => s.task_id === task.id && s.role === 'task-reviewer')) return;
  void import('../review').then(module => module.codeTaskReview.launchIndependentReview(task.id))
    .catch(error => console.warn('[plangent] automatic plan review not started:', error instanceof Error ? error.message : error));
});
