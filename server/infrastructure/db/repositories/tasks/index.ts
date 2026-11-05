import { getDb } from '../../schema';

export const rowsSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC').all(...params);
export const rowSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(...params);
export const lastNumberSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT key FROM tasks WHERE project_id=?').all(...params);
export const createTaskInsertTasks = (...params: unknown[]) => getDb().prepare(`
      INSERT INTO tasks (id, project_id, key, title, description, jira_url, branch_name, kind, auto_review, closed_at, close_reason, origin_task_id, external_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...params);
export const createTaskUpdateTasks = (...params: unknown[]) => getDb().prepare('UPDATE tasks SET description=NULL, description_migrated=1 WHERE id=?').run(...params);
export const updateTaskUpdateTasks = (...params: unknown[]) => getDb().prepare(`
    UPDATE tasks SET key=?, title=?, description=?, jira_url=?, branch_name=?, status=?, finish_scenario=?, target_branch=?, external_key=?, base_branch=?, kind=?, auto_review=?, closed_at=?, close_reason=?, origin_task_id=? WHERE id=?
  `).run(...params);
export const deletedDeleteTasks = (...params: unknown[]) => getDb().prepare('DELETE FROM tasks WHERE id = ?').run(...params);
