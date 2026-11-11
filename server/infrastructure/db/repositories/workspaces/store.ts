import { getDb } from '../../schema';

export function patchWorkspace(id: string, entries: [string, unknown][]): void {
  const allowed = entries.filter(([key]) => ['status', 'error', 'setup_log', 'removed_at'].includes(key));
  if (allowed.length) getDb().prepare('UPDATE workspaces SET ' + allowed.map(([key]) => key + '=?').join(',') + ' WHERE id=?')
    .run(...allowed.map(([, value]) => value), id);
}

export const getWorkspaceWorkspaces = (...params: unknown[]) => getDb().prepare('SELECT * FROM workspaces WHERE id=?').get(...params);
export const findActiveWorkspace = (...params: unknown[]) => getDb().prepare("SELECT * FROM workspaces WHERE task_id=? AND status <> 'removed'").get(...params);
export const listWorkspacesWorkspaces = (...params: unknown[]) => getDb().prepare("SELECT * FROM workspaces WHERE project_id=? AND status <> 'removed' ORDER BY created_at").all(...params);
export const insertWorkspaceWorkspaces = (...params: unknown[]) => getDb().prepare(`INSERT INTO workspaces(id,project_id,task_id,branch,base_branch,path,port_slot,status) VALUES (?,?,?,?,?,?,?,'preparing')`).run(...params);
export const activePortSlots = (projectId: string): number[] =>
  (getDb().prepare("SELECT port_slot FROM workspaces WHERE project_id=? AND status <> 'removed'").all(projectId) as { port_slot: number }[]).map(row => row.port_slot);
/** Do not clear a newer workspace selection when an older workspace stops. */
export const clearViewingIfWorkspaceMatches = (key: string, workspaceId: string): boolean =>
  getDb().prepare("UPDATE app_settings SET value='' WHERE key=? AND value=?").run(key, workspaceId).changes > 0;
