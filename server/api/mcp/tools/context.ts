import type { AgentSession } from '../../../core/agents';
import { getLatestPlan } from '../../../core/preparation/plans';
import { submitPlan } from '../../../core/preparation/plan-file';
import { getOrchestrator } from '../../../core/execution/orchestrator';
import { planningToolContext } from '../../../core/preparation/prompts';
import { resolvePlanTemplate } from '../../../core/library/plan-template';
import { getTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
export function planTask(session: AgentSession) {
  const task = session.task_id ? getTask(session.task_id) : null;
  const project = getProject(session.project_id);
  if (!task || !project) throw new Error('Task not found');
  return { task, project };
}
export function planResult(name: 'get_plan' | 'submit_plan', session: AgentSession, args: Record<string, unknown>): unknown {
  const { task, project } = planTask(session);
  if (name === 'submit_plan') {
    const executing = !!getOrchestrator(task.id);
    const { steps, removed } = submitPlan(task, project.repo_path, String(args.content), !executing, session.id);
    return { saved: true, steps, ...(removed.length ? { removedSteps: removed } : {}) };
  }
  return planningToolContext({ taskId: task.id, repoPath: project.repo_path, projectName: project.name, taskKey: task.key, taskTitle: task.title ?? undefined,
    taskDescription: task.description ?? undefined, planContent: getLatestPlan(task.id)?.content, planTemplate: resolvePlanTemplate(project.id), });
}
