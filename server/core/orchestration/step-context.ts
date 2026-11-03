import type { AgentSession } from '../agent-sessions/types';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getLatestPlan } from './plans';
import { selectedStepContext } from './analysis-context';

/** What get_step_context returns to an executor: its steps and the materials they link to. */
export function stepContextFor(session: AgentSession) {
  const task = session.task_id ? getTask(session.task_id) : null;
  const project = getProject(session.project_id);
  if (!task || !project) throw new Error('Task not found');
  const plan = getLatestPlan(task.id);
  if (!plan) return { steps: [], analysis: [], materials: [], missing: [] };
  return selectedStepContext(task.id, project.repo_path, task.key, plan.content, session.step_ids);
}
