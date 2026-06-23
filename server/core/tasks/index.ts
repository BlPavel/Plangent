import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../infrastructure/db/schema';
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
  return getTask(id)!;
}

export function updateTask(id: string, data: Partial<Task>): Task | null {
  const db = getDb();
  const current = getTask(id);
  if (!current) return null;
  const u = { ...current, ...data };
  db.prepare(`
    UPDATE tasks SET key=?, title=?, description=?, jira_url=?, branch_name=?, status=? WHERE id=?
  `).run(u.key, u.title ?? null, u.description ?? null, u.jira_url ?? null, u.branch_name ?? null, u.status, id);
  return getTask(id);
}

export function deleteTask(id: string): boolean {
  return getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
}
