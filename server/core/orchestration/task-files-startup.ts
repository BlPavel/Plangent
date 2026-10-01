import fs from 'fs';
import { getDb } from '../../infrastructure/db/schema';
import { getProject } from '../projects';
import { getLatestPlan, updatePlan, createPlan } from './plans';
import { getPlanFilePath, migratePlanFile } from './task-files';
import { materializePlanFile, watchPlanFile, deletePlanFile } from './plan-file';
import { materializeTaskAnalysis } from './analysis';
import type { Task } from '../../models';

export function initTaskFiles(): void {
  for (const task of getDb().prepare('SELECT * FROM tasks').all() as Task[]) {
    const project = getProject(task.project_id);
    if (!project) continue;
    if (task.status === 'done') { deletePlanFile(task, project.repo_path); continue; }
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
}
