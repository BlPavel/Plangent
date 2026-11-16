import { getDb } from '../../schema';

export const rowsSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC').all(...params);
export const rowSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(...params);
export const lastNumberSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT key FROM tasks WHERE project_id=?').all(...params);
export const createTaskInsertTasks = (...params: unknown[]) => getDb().prepare(`
      INSERT INTO tasks (id, project_id, key, title, description, jira_url, branch_name, kind, auto_review, closed_at, close_reason, origin_task_id, external_key, review_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...params);
export const createTaskUpdateTasks = (...params: unknown[]) => getDb().prepare('UPDATE tasks SET description=NULL, description_migrated=1 WHERE id=?').run(...params);
export const updateTaskUpdateTasks = (...params: unknown[]) => getDb().prepare(`
    UPDATE tasks SET key=?, title=?, description=?, jira_url=?, branch_name=?, status=?, finish_scenario=?, target_branch=?, external_key=?, base_branch=?, kind=?, auto_review=?, closed_at=?, close_reason=?, origin_task_id=?, review_agent=? WHERE id=?
  `).run(...params);
/**
 * A finish keeps a reference to the working folder it used, and the folders go with their task: without letting go of that
 * reference first, the database refuses to delete any task that was ever finished in a working folder.
 */
export const deletedDeleteTasks = (id: unknown) => getDb().transaction(() => {
  getDb().prepare('UPDATE finish_runs SET workspace_id = NULL WHERE workspace_id IN (SELECT id FROM workspaces WHERE task_id = ?)').run(id);
  return getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
})();
