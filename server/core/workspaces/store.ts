import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DATA_DIR, getDb } from '../../infrastructure/db/schema';
import type { Workspace } from '../../models';
import { CodeError } from '../code/files';
import { broadcast } from '../shared/events';

export function workspaceFolder(projectId: string, taskKey: string): string {
  for (const part of [projectId, taskKey]) {
    if (!part || part === '.' || part === '..' || /[/\\:\x00-\x1f]/.test(part)) throw new CodeError('Invalid workspace path');
  }
  return path.resolve(DATA_DIR, 'workspaces', projectId, taskKey);
}
export function getWorkspace(id: string): Workspace {
  const row = getDb().prepare('SELECT * FROM workspaces WHERE id=?').get(id) as Workspace | undefined;
  if (!row) throw new CodeError('Workspace not found', 404);
  return row;
}
export function activeWorkspace(taskId: string): Workspace | null {
  return getDb().prepare("SELECT * FROM workspaces WHERE task_id=? AND status <> 'removed'").get(taskId) as Workspace | undefined ?? null;
}
export function listWorkspaces(projectId: string): Workspace[] {
  return getDb().prepare("SELECT * FROM workspaces WHERE project_id=? AND status <> 'removed' ORDER BY created_at").all(projectId) as Workspace[];
}
export function insertWorkspace(input: Pick<Workspace, 'project_id' | 'task_id' | 'branch' | 'base_branch' | 'path'>): Workspace {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO workspaces(id,project_id,task_id,branch,base_branch,path,status) VALUES (?,?,?,?,?,?,'preparing')`)
    .run(id, input.project_id, input.task_id, input.branch, input.base_branch, input.path);
  return updateWorkspace(id, {});
}
export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'status' | 'error' | 'setup_log' | 'removed_at'>>): Workspace {
  const entries = Object.entries(patch).filter(([key]) => ['status', 'error', 'setup_log', 'removed_at'].includes(key));
  if (entries.length) getDb().prepare('UPDATE workspaces SET ' + entries.map(([key]) => key + '=?').join(',') + ' WHERE id=?')
    .run(...entries.map(([, value]) => value), id);
  const workspace = getWorkspace(id);
  if (workspace.status !== 'ready' && patch.status) {
    const key = 'workspace:viewing:' + workspace.project_id;
    const cleared = getDb().prepare("UPDATE app_settings SET value='' WHERE key=? AND value=?").run(key, id);
    if (cleared.changes) broadcast({ type: 'workspace:viewing', projectId: workspace.project_id, workspace: null });
  }
  broadcast({ type: 'workspace:update', projectId: workspace.project_id, workspace });
  return workspace;
}
