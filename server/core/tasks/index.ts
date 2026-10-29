import { activeWorkspace, removeWorkspace } from '../workspaces';
import { broadcast } from '../shared/events';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../infrastructure/db/schema';
import { createAnalysisSection } from '../orchestration/analysis';
import { deletePlanFile } from '../orchestration/plan-file';
import { getProject } from '../projects';
import { Task } from '../../models';

function parseTask(row: Record<string, unknown>): Task {
  return { ...row, auto_review: !!row.auto_review } as unknown as Task;
}

function validateWorkFields(data: Partial<Task>): void {
  if (data.kind !== undefined && !['task', 'errand'].includes(data.kind)) throw new Error('Invalid task kind');
  if (data.auto_review !== undefined && typeof data.auto_review !== 'boolean') throw new Error('Invalid auto_review');
  if (data.close_reason != null && !['done', 'cancelled'].includes(data.close_reason)) throw new Error('Invalid close reason');
  if (data.closed_at != null && (typeof data.closed_at !== 'string' || !Number.isFinite(Date.parse(data.closed_at)))) throw new Error('Invalid closed_at');
  if (data.origin_task_id != null && (typeof data.origin_task_id !== 'string' || !getTask(data.origin_task_id))) throw new Error('Origin task not found');
  // Номер задачи: any short line (a tracker key, a number); several works may share it.
  if (data.external_key != null && (typeof data.external_key !== 'string' || data.external_key.length > 100 || /[\r\n\0]/.test(data.external_key))) throw new Error('Номер задачи: одна строка до 100 символов');
}

export function listTasks(project_id: string): Task[] {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC').all(project_id) as Record<string, unknown>[];
  return rows.map(parseTask);
}

export function getTask(id: string): Task | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parseTask(row) : null;
}

export function createTask(data: { project_id: string; key?: string; title?: string; description?: string; jira_url?: string; branch_name?: string } & Partial<Pick<Task, 'kind' | 'auto_review' | 'closed_at' | 'close_reason' | 'origin_task_id' | 'external_key'>>): Task {
  const id = uuidv4();
  const db = getDb();
  validateWorkFields(data);
  if (data.key !== undefined && (typeof data.key !== 'string' || !data.key.trim())) throw new Error('Invalid task key');
  return db.transaction(() => {
    const lastNumber = (db.prepare('SELECT key FROM tasks WHERE project_id=?').all(data.project_id) as { key: string }[])
      .reduce((max, row) => { const match = /^Задача-(\d+)$/.exec(row.key); return match ? Math.max(max, Number(match[1])) : max; }, 0);
    const key = data.key ?? 'Задача-' + (lastNumber + 1);
    db.prepare(`
      INSERT INTO tasks (id, project_id, key, title, description, jira_url, branch_name, kind, auto_review, closed_at, close_reason, origin_task_id, external_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.project_id, key, data.title ?? null, data.description ?? null, data.jira_url ?? null, data.branch_name ?? null,
      data.kind ?? 'task', +(data.auto_review ?? false), data.closed_at ?? null, data.close_reason ?? null, data.origin_task_id ?? null, data.external_key ?? null);
    if (data.description?.trim()) {
      createAnalysisSection({ task_id: id, title: 'Описание задачи', description: data.description, kind: 'source', author: 'developer' });
    }
    db.prepare('UPDATE tasks SET description=NULL, description_migrated=1 WHERE id=?').run(id);
    const task = getTask(id)!;
    broadcast({ type: 'task_updated', taskId: id, projectId: task.project_id });
    return task;
  }).immediate();
}

export function updateTask(id: string, data: Partial<Task>): Task | null {
  const db = getDb();
  const current = getTask(id);
  if (!current) return null;
  validateWorkFields(data);
  if (data.finish_scenario != null && !['nothing','commits','push','full'].includes(data.finish_scenario)) throw new Error('Invalid finish scenario');
  if (data.target_branch != null && (typeof data.target_branch !== 'string' || /[\r\n\0]/.test(data.target_branch))) throw new Error('Invalid target branch');
  if (data.base_branch != null && (typeof data.base_branch !== 'string' || /[\r\n\0]/.test(data.base_branch))) throw new Error('Invalid base branch');
  const u = { ...current, ...Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined)) };
  db.prepare(`
    UPDATE tasks SET key=?, title=?, description=?, jira_url=?, branch_name=?, status=?, finish_scenario=?, target_branch=?, external_key=?, base_branch=?, kind=?, auto_review=?, closed_at=?, close_reason=?, origin_task_id=? WHERE id=?
  `).run(u.key, u.title ?? null, u.description ?? null, u.jira_url ?? null, u.branch_name ?? null, u.status, u.finish_scenario ?? null, u.target_branch ?? null, u.external_key ?? null, u.base_branch ?? null,
    u.kind, +u.auto_review, u.closed_at ?? null, u.close_reason ?? null, u.origin_task_id ?? null, id);
  broadcast({ type: 'task_updated', taskId: id, projectId: current.project_id });
  return getTask(id);
}

export async function deleteTask(id: string, input: { discard?: boolean } = {}): Promise<boolean> {
  const workspace = activeWorkspace(id);
  if (workspace) await removeWorkspace(workspace.id, { discard: input.discard });
  const task = getTask(id);
  if (task) {
    const project = getProject(task.project_id);
    if (project) deletePlanFile(task, project.repo_path);
  }
  const deleted = getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  if (task && deleted) broadcast({ type: 'task_updated', taskId: id, projectId: task.project_id });
  return deleted;
}
