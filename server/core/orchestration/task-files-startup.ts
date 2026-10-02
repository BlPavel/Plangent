import fs from 'fs';
import { getDb } from '../../infrastructure/db/schema';
import { getProject } from '../projects';
import { getLatestPlan, updatePlan, createPlan } from './plans';
import { getPlanFilePath, migratePlanFile } from './task-files';
import { materializePlanFile, watchPlanFile, deletePlanFile } from './plan-file';
import { materializeTaskAnalysis } from './analysis';
import type { Task } from '../../models';

export function initTaskFiles(): void {
  for (const task of getDb().prepare('SELECT * FROM tasks').all() as Task[]) initTaskFile(task);
}

/** Brings a task's .plangent folder in line with the DB and starts watching it. */
export function initTaskFile(task: Task): void {
  const project = getProject(task.project_id);
  if (!project) return;
  if (task.status === 'done') { deletePlanFile(task, project.repo_path); return; }
  migratePlanFile(project.repo_path, task.key);
  const file = getPlanFilePath(project.repo_path, task.key);
  const plan = getLatestPlan(task.id) ?? (fs.existsSync(file)
    ? createPlan({ task_id: task.id, content: fs.readFileSync(file, 'utf8') }) : null);
  if (plan) {
    if (fs.existsSync(file)) updatePlan(plan.id, fs.readFileSync(file, 'utf8'));
    materializePlanFile(task, getLatestPlan(task.id)!, project.repo_path);
    watchPlanFile(task, plan.id, project.repo_path);
  }
  materializeTaskAnalysis(task.id, true);
}
