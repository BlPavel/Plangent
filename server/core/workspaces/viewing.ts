import * as records from '../../infrastructure/db/repositories/workspaces/viewing';
import { getProject } from '../projects';
import { getWorkspace } from './store';
import { rootForWorkspace } from './roots';
import { broadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
export function viewedWorkspaceId(projectId: string): string | null {
  const row = records.viewedWorkspaceIdAppSettings('workspace:viewing:' + projectId) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const workspace = getWorkspace(row.value);
    return workspace.project_id === projectId && workspace.status === 'ready' ? workspace.id : null;
  } catch { return null; }
}
export function rootForViewing(projectId: string, workspaceId?: unknown): string {
  return rootForWorkspace(projectId, workspaceId === undefined ? viewedWorkspaceId(projectId) : workspaceId);
}
export function viewing(projectId: string) {
  if (!getProject(projectId)) throw new DomainError('Project not found', 404);
  const id = viewedWorkspaceId(projectId);
  return id ? getWorkspace(id) : null;
}
export function setViewing(projectId: string, workspaceId: unknown) {
  if (workspaceId !== null) rootForWorkspace(projectId, workspaceId);
  else if (!getProject(projectId)) throw new DomainError('Project not found', 404);
  if (workspaceId === undefined) throw new DomainError('workspaceId is required');
  records.setViewingAppSettings('workspace:viewing:' + projectId, workspaceId ?? '');
  const workspace = viewing(projectId);
  broadcast({ type: 'workspace:viewing', projectId, workspace });
  return workspace;
}
