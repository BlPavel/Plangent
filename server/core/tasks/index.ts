import { moduleDependencies } from './dependencies';
import { transaction } from '../../infrastructure/db/repositories/tasks/transaction';
import * as queries from '../../infrastructure/db/repositories/tasks/index';
import type { activeWorkspace, removeWorkspace } from '../workspaces';
import { broadcast } from '../shared';
import { v4 as uuidv4 } from 'uuid';
import type { createAnalysisSection } from '../preparation';
import type { deletePlanFile } from '../preparation';
import { getProject } from '../projects';
import { Task } from '../../models';

function parseTask(row: Record<string, unknown>): Task {
  return { ...row, auto_review: !!row.auto_review, review_agent: parseReviewAgent(row.review_agent) } as unknown as Task;
}

function parseReviewAgent(value: unknown): Task['review_agent'] {
  try { return typeof value === 'string' && value ? JSON.parse(value) : null; } catch { return null; }
}

function validateWorkFields(data: Partial<Task>): void {
  if (data.kind !== undefined && !['task', 'errand'].includes(data.kind)) throw new Error('Invalid task kind');
  if (data.auto_review !== undefined && typeof data.auto_review !== 'boolean') throw new Error('Invalid auto_review');
  if (data.review_agent != null && (typeof data.review_agent !== 'object' || typeof data.review_agent.agent_id !== 'string' || !data.review_agent.agent_id)) throw new Error('Invalid review_agent');
  if (data.close_reason != null && !['done', 'cancelled'].includes(data.close_reason)) throw new Error('Invalid close reason');
  if (data.closed_at != null && (typeof data.closed_at !== 'string' || !Number.isFinite(Date.parse(data.closed_at)))) throw new Error('Invalid closed_at');
  if (data.origin_task_id != null && (typeof data.origin_task_id !== 'string' || !getTask(data.origin_task_id))) throw new Error('Origin task not found');
  // Номер задачи: any short line (a tracker key, a number); several works may share it.
  if (data.external_key != null && (typeof data.external_key !== 'string' || data.external_key.length > 100 || /[\r\n\0]/.test(data.external_key))) throw new Error('Номер задачи: одна строка до 100 символов');
}

export function listTasks(project_id: string): Task[] {
  const rows = queries.rowsSelectTasks(project_id) as Record<string, unknown>[];
  return rows.map(parseTask);
}

export function getTask(id: string): Task | null {
  const row = queries.rowSelectTasks(id) as Record<string, unknown> | undefined;
  return row ? parseTask(row) : null;
}

export function createTask(data: { project_id: string; key?: string; title?: string; description?: string; jira_url?: string; branch_name?: string } & Partial<Pick<Task, 'kind' | 'auto_review' | 'review_agent' | 'closed_at' | 'close_reason' | 'origin_task_id' | 'external_key'>>): Task {
  const id = uuidv4();
  validateWorkFields(data);
  if (data.key !== undefined && (typeof data.key !== 'string' || !data.key.trim())) throw new Error('Invalid task key');
  return transaction(() => {
    const lastNumber = (queries.lastNumberSelectTasks(data.project_id) as { key: string }[])
      .reduce((max, row) => { const match = /^Задача-(\d+)$/.exec(row.key); return match ? Math.max(max, Number(match[1])) : max; }, 0);
    const key = data.key ?? 'Задача-' + (lastNumber + 1);
    queries.createTaskInsertTasks(id, data.project_id, key, data.title ?? null, data.description ?? null, data.jira_url ?? null, data.branch_name ?? null, data.kind ?? 'task', +(data.auto_review ?? false), data.closed_at ?? null, data.close_reason ?? null, data.origin_task_id ?? null, data.external_key ?? null, data.review_agent ? JSON.stringify(data.review_agent) : null);
    if (data.description?.trim()) {
      moduleDependencies.preparation.createAnalysisSection({ task_id: id, title: 'Описание задачи', description: data.description, kind: 'source', author: 'developer' });
    }
    queries.createTaskUpdateTasks(id);
    const task = getTask(id)!;
    broadcast({ type: 'task_updated', taskId: id, projectId: task.project_id });
    return task;
  }, 'immediate');
}

export function updateTask(id: string, data: Partial<Task>): Task | null {
    const current = getTask(id);
  if (!current) return null;
  validateWorkFields(data);
  if (data.finish_scenario != null && !['nothing','commits','push','full'].includes(data.finish_scenario)) throw new Error('Invalid finish scenario');
  if (data.target_branch != null && (typeof data.target_branch !== 'string' || /[\r\n\0]/.test(data.target_branch))) throw new Error('Invalid target branch');
  if (data.base_branch != null && (typeof data.base_branch !== 'string' || /[\r\n\0]/.test(data.base_branch))) throw new Error('Invalid base branch');
  const u = { ...current, ...Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined)) };
  queries.updateTaskUpdateTasks(u.key, u.title ?? null, u.description ?? null, u.jira_url ?? null, u.branch_name ?? null, u.status, u.finish_scenario ?? null, u.target_branch ?? null, u.external_key ?? null, u.base_branch ?? null, u.kind, +u.auto_review, u.closed_at ?? null, u.close_reason ?? null, u.origin_task_id ?? null, u.review_agent ? JSON.stringify(u.review_agent) : null, id);
  broadcast({ type: 'task_updated', taskId: id, projectId: current.project_id });
  return getTask(id);
}

export async function deleteTask(id: string, input: { discard?: boolean } = {}): Promise<boolean> {
  const workspace = moduleDependencies.workspaces.activeWorkspace(id);
  if (workspace) await moduleDependencies.workspaces.removeWorkspace(workspace.id, { discard: input.discard });
  const task = getTask(id);
  if (task) {
    const project = getProject(task.project_id);
    if (project) moduleDependencies.preparation.deletePlanFile(task, project.repo_path);
  }
  const deleted = queries.deletedDeleteTasks(id).changes > 0;
  if (task && deleted) broadcast({ type: 'task_updated', taskId: id, projectId: task.project_id });
  return deleted;
}

export { getPlanFilePath } from './task-files';
export { getAnalysisDirectory } from './task-files';
export { materializeAnalysis } from './task-files';
export { deleteTaskDirectory } from './task-files';
export { materializeMaterial } from './task-files';
export { getTaskDirectory } from './task-files';
export { migratePlanFile } from './task-files';
export { initTaskFile } from './task-files-startup';
export { configureDependencies as configureTasksDependencies } from './dependencies';
