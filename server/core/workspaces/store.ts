import * as records from '../../infrastructure/db/repositories/workspaces/store';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DATA_DIR } from '../../infrastructure/paths';
import type { Workspace } from '../../models';
import { DomainError } from '../../models/domain-error';
import { broadcast } from '../shared';

export function workspaceFolder(projectId: string, taskKey: string): string {
  for (const part of [projectId, taskKey]) {
    if (!part || part === '.' || part === '..' || /[/\\:\x00-\x1f]/.test(part)) throw new DomainError('Invalid workspace path');
  }
  return path.resolve(DATA_DIR, 'workspaces', projectId, taskKey);
}
export function getWorkspace(id: string): Workspace {
  const row = records.getWorkspaceWorkspaces(id) as Workspace | undefined;
  if (!row) throw new DomainError('Workspace not found', 404);
  return row;
}
export function activeWorkspace(taskId: string): Workspace | null {
  return records.findActiveWorkspace(taskId) as Workspace | undefined ?? null;
}
export function listWorkspaces(projectId: string): Workspace[] {
  return records.listWorkspacesWorkspaces(projectId) as Workspace[];
}
export function insertWorkspace(input: Pick<Workspace, 'project_id' | 'task_id' | 'branch' | 'base_branch' | 'path'>): Workspace {
  const id = randomUUID();
  records.insertWorkspaceWorkspaces(id, input.project_id, input.task_id, input.branch, input.base_branch, input.path);
  return updateWorkspace(id, {});
}
export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'status' | 'error' | 'setup_log' | 'removed_at'>>): Workspace {
  const entries = Object.entries(patch).filter(([key]) => ['status', 'error', 'setup_log', 'removed_at'].includes(key));
  if (entries.length) records.patchWorkspace(id, entries);
  const workspace = getWorkspace(id);
  if (workspace.status !== 'ready' && patch.status) {
    const key = 'workspace:viewing:' + workspace.project_id;
    const cleared = records.clearViewingIfWorkspaceMatches(key, id);
    if (cleared) broadcast({ type: 'workspace:viewing', projectId: workspace.project_id, workspace: null });
  }
  broadcast({ type: 'workspace:update', projectId: workspace.project_id, workspace });
  return workspace;
}
