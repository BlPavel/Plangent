import { moduleDependencies } from './dependencies';
import * as queries from '../../infrastructure/db/repositories/tasks/task-files-startup';
import fs from 'fs';
import { getProject } from '../projects';
import type { getLatestPlan, updatePlan, createPlan } from '../preparation';
import { getPlanFilePath, migratePlanFile } from './task-files';
import type { materializePlanFile, watchPlanFile, deletePlanFile } from '../preparation';
import type { materializeTaskAnalysis } from '../preparation';
import type { Task } from '../../models';
import type { getLatestMaterial } from '../preparation';
import { materializeMaterial } from './task-files';

export function initTaskFiles(): void {
  for (const task of queries.initTaskFilesSelectTasks() as Task[]) initTaskFile(task);
}

/** Brings a task's .plangent folder in line with the DB and starts watching it. */
export function initTaskFile(task: Task): void {
  const project = getProject(task.project_id);
  if (!project) return;
  if (task.status === 'done') { moduleDependencies.preparation.deletePlanFile(task, project.repo_path); return; }
  migratePlanFile(project.repo_path, task.key);
  const file = getPlanFilePath(project.repo_path, task.key);
  const plan = moduleDependencies.preparation.getLatestPlan(task.id) ?? (fs.existsSync(file)
    ? moduleDependencies.preparation.createPlan({ task_id: task.id, content: fs.readFileSync(file, 'utf8') }) : null);
  if (plan) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      if (content !== plan.content) moduleDependencies.preparation.updatePlan(plan.id, content);
    }
    moduleDependencies.preparation.materializePlanFile(task, moduleDependencies.preparation.getLatestPlan(task.id)!, project.repo_path);
    moduleDependencies.preparation.watchPlanFile(task, plan.id, project.repo_path);
  }
  moduleDependencies.preparation.materializeTaskAnalysis(task.id, true);
  for (const type of ['architecture', 'qa'] as const) {
    const material = moduleDependencies.preparation.getLatestMaterial(task.id, type);
    if (material) materializeMaterial(task, project.repo_path, type, material.content);
  }
}
