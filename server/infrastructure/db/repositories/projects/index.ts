import { getDb } from '../../schema';

export const rowsSelectProjects = (...params: unknown[]) => getDb().prepare('SELECT * FROM projects WHERE kind=? ORDER BY name COLLATE NOCASE').all(...params);
export const rowsSelectProjects2 = (...params: unknown[]) => getDb().prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all(...params);
export const rowSelectProjects = (...params: unknown[]) => getDb().prepare('SELECT * FROM projects WHERE id = ?').get(...params);
export const rowSelectProjects2 = (...params: unknown[]) => getDb().prepare(`SELECT * FROM projects WHERE key = ? AND kind <> 'group'`).get(...params);
export const groupMembersSelectProjects = (...params: unknown[]) => getDb().prepare(`SELECT * FROM projects WHERE group_id=? AND kind='project' ORDER BY name COLLATE NOCASE`).all(...params);
export const saveDocsSettingsUpdateProjects = (...params: unknown[]) => getDb().prepare('UPDATE projects SET source_type=?,connection_id=?,docs_config=?,docs_selection=? WHERE id=?').run(...params);
export const createProjectInsertProjects = (...params: unknown[]) => getDb().prepare(`
    INSERT INTO projects (id, kind, name, key, repo_path, group_id, icon, description, default_agent_id, config, hide_from_git)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...params);
export const updateProjectUpdateProjects = (...params: unknown[]) => getDb().prepare(`
    UPDATE projects SET name=?, key=?, repo_path=?, group_id=?, icon=?, description=?, default_agent_id=?, config=?, hide_from_git=? WHERE id=?
  `).run(...params);
export const deletedDeleteProjects = (...params: unknown[]) => getDb().prepare('DELETE FROM projects WHERE id = ?').run(...params);
export const saveGitDataUpdateProjects = (...params: unknown[]) => getDb().prepare('UPDATE projects SET clone_url=?,host_project_path=?,git_settings=? WHERE id=?').run(...params);
export const activeSelectTasks = (...params: unknown[]) => getDb().prepare(`SELECT project_id, COUNT(*) AS n FROM tasks WHERE status <> 'done' GROUP BY project_id`).all(...params);
