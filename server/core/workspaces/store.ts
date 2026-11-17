import * as records from '../../infrastructure/db/repositories/workspaces/store';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../infrastructure/paths';
import type { Workspace } from '../../models';
import { DomainError } from '../../models/domain-error';
import { broadcast } from '../shared';

function sameVolume(a: string, b: string): boolean {
  if (process.platform === 'win32') return path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase();
  try { return fs.statSync(a).dev === fs.statSync(b).dev; } catch { return true; }
}
/**
 * Dependency folders are hard-linked from the main folder, and hard links cannot cross disks:
 * a repository on another disk than the application data keeps its workspaces next to itself.
 */
function workspacesRoot(repoPath: string): string {
  return sameVolume(repoPath, DATA_DIR) ? path.resolve(DATA_DIR, 'workspaces') : path.resolve(repoPath, '..', '.plangent-workspaces');
}
export function workspaceFolder(project: { id: string; repo_path: string }, taskKey: string): string {
  for (const part of [project.id, taskKey]) {
    if (!part || part === '.' || part === '..' || /[/\\:\x00-\x1f]/.test(part)) throw new DomainError('Invalid workspace path');
  }
  return path.join(workspacesRoot(project.repo_path), project.id, taskKey);
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
export function insertWorkspace(input: Pick<Workspace, 'project_id' | 'task_id' | 'branch' | 'base_branch' | 'path'> & { port_slot?: number }): Workspace {
  const id = randomUUID();
  records.insertWorkspaceWorkspaces(id, input.project_id, input.task_id, input.branch, input.base_branch, input.path, input.port_slot ?? 0);
  return updateWorkspace(id, {});
}
export function activePortSlots(projectId: string): number[] {
  return records.activePortSlots(projectId);
}
export function updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'status' | 'error' | 'setup_log' | 'removed_at' | 'setup_done'>>): Workspace {
  const entries = Object.entries(patch).filter(([key]) => ['status', 'error', 'setup_log', 'removed_at', 'setup_done'].includes(key));
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
