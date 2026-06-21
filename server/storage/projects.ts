import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema';
import { Project, ProjectConfig } from '../models/types';

function parse(row: Record<string, unknown>): Project {
  return {
    ...(row as Omit<Project, 'config' | 'hide_from_git'>),
    config: JSON.parse(row.config as string || '{}'),
    hide_from_git: Boolean(row.hide_from_git),
  };
}

export function listProjects(): Project[] {
  return (getDb().prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(parse);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

export function createProject(data: { name: string; repo_path: string; default_agent_id?: string; config?: ProjectConfig; hide_from_git?: boolean }): Project {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO projects (id, name, repo_path, default_agent_id, config, hide_from_git) VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.repo_path, data.default_agent_id ?? null, JSON.stringify(data.config ?? {}), data.hide_from_git === false ? 0 : 1);
  return getProject(id)!;
}

export function updateProject(id: string, data: Partial<Omit<Project, 'id' | 'created_at'>>): Project | null {
  const current = getProject(id);
  if (!current) return null;
  const u = { ...current, ...data, config: data.config ?? current.config };
  getDb().prepare(`
    UPDATE projects SET name=?, repo_path=?, default_agent_id=?, config=?, hide_from_git=? WHERE id=?
  `).run(u.name, u.repo_path, u.default_agent_id ?? null, JSON.stringify(u.config), u.hide_from_git ? 1 : 0, id);
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}
