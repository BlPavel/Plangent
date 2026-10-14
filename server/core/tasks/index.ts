import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../infrastructure/db/schema';
import { createAnalysisSection } from '../orchestration/analysis';
import { deletePlanFile } from '../orchestration/plan-file';
import { getProject } from '../projects';
import { Task } from '../../models';

function parseTask(row: Record<string, unknown>): Task {
  return row as unknown as Task;
}

export function listTasks(project_id: string): Task[] {
  const rows = getDb().prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC').all(project_id) as Record<string, unknown>[];
  return rows.map(parseTask);
}

export function getTask(id: string): Task | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parseTask(row) : null;
}

export function createTask(data: { project_id: string; key: string; title?: string; description?: string; jira_url?: string; branch_name?: string }): Task {
  const id = uuidv4();
  const db = getDb();
  db.prepare(`
    INSERT INTO tasks (id, project_id, key, title, description, jira_url, branch_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.project_id, data.key, data.title ?? null, data.description ?? null, data.jira_url ?? null, data.branch_name ?? null);
  if (data.description?.trim()) {
    createAnalysisSection({ task_id: id, title: 'Описание задачи', description: data.description, kind: 'source', author: 'developer' });
  }
  db.prepare('UPDATE tasks SET description=NULL, description_migrated=1 WHERE id=?').run(id);
  return getTask(id)!;
}

export function updateTask(id: string, data: Partial<Task>): Task | null {
  const db = getDb();
  const current = getTask(id);
  if (!current) return null;
  if (data.finish_scenario != null && !['nothing','commits','push','full'].includes(data.finish_scenario)) throw new Error('Invalid finish scenario');
  if (data.target_branch != null && (typeof data.target_branch !== 'string' || /[\r\n\0]/.test(data.target_branch))) throw new Error('Invalid target branch');
  if (data.external_key != null && (typeof data.external_key !== 'string' || data.external_key && !/^[A-Z][A-Z0-9_]*-\d+$/.test(data.external_key))) throw new Error('Ключ внешней задачи: PROJ-123');
  if (data.base_branch != null && (typeof data.base_branch !== 'string' || /[\r\n\0]/.test(data.base_branch))) throw new Error('Invalid base branch');
  const u = { ...current, ...Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined)) };
  db.prepare(`
    UPDATE tasks SET key=?, title=?, description=?, jira_url=?, branch_name=?, status=?, finish_scenario=?, target_branch=?, external_key=?, base_branch=? WHERE id=?
  `).run(u.key, u.title ?? null, u.description ?? null, u.jira_url ?? null, u.branch_name ?? null, u.status, u.finish_scenario ?? null, u.target_branch ?? null, u.external_key ?? null, u.base_branch ?? null, id);
  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const task = getTask(id);
  if (task) {
    const project = getProject(task.project_id);
    if (project) deletePlanFile(task, project.repo_path);
  }
  return getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
}
