import path from 'node:path';
import { getProject } from '../projects';
import { getTask } from '../tasks';
import { writableRoots } from '../projects/workspace';
import { activeWorkspace, getWorkspace } from './store';
import { CodeError } from '../code/files';
import type { AgentSession } from '../agent-sessions/types';

export function rootForTask(taskId: string): string {
  const task = getTask(taskId), project = task && getProject(task.project_id);
  if (!task || !project) throw new CodeError('Task not found', 404);
  return project.kind === 'project' ? activeWorkspace(taskId)?.path ?? project.repo_path : project.repo_path;
}
export async function rootForSession(session: AgentSession): Promise<string> {
  if (session.metadata.mr_private) return (await import('../mr-review/private')).reviewWorkspace(session.id);
  const project = getProject(session.project_id);
  if (!project) throw new CodeError('Project not found', 404);
  if (!session.task_id) return rootForWorkspace(project.id, session.metadata.workspace_id);
  if (getTask(session.task_id)?.project_id !== project.id) throw new CodeError('Task not found', 404);
  if (session.metadata.workspace_id && getWorkspace(String(session.metadata.workspace_id)).task_id !== session.task_id)
    throw new CodeError('Workspace belongs to another task', 409);
  if (getTask(session.task_id)?.status === 'done') throw new CodeError('Работа закрыта', 409);
  assertTaskWorkspaceReady(session.task_id);
  return rootForTask(session.task_id);
}
export function assertTaskWorkspaceReady(taskId: string): void {
  const workspace = activeWorkspace(taskId);
  if (workspace && workspace.status !== 'ready') throw new CodeError(workspace.error || 'Workspace is not ready', 409);
}
export async function writableRootsForSession(session: AgentSession): Promise<string[]> {
  const project = getProject(session.project_id);
  if (!project) throw new CodeError('Project not found', 404);
  const root = await rootForSession(session);
  if (session.metadata.mr_private) return [];
  if (project.kind === 'group') return writableRoots(project);
  if (session.role === 'code-fixer' || session.role === 'conflict-resolver') return [root];
  const task = session.task_id ? getTask(session.task_id) : null;
  return task && activeWorkspace(task.id) ? [root, path.join(project.repo_path, '.plangent', task.key)] : [root];
}

/** Resolve an explicitly selected worktree; never fall back on an invalid selection. */
export function rootForWorkspace(projectId: string, workspaceId?: unknown): string {
  const project = getProject(projectId);
  if (!project) throw new CodeError('Project not found', 404);
  if (workspaceId === undefined || workspaceId === null) return project.repo_path;
  if (typeof workspaceId !== 'string' || !workspaceId) throw new CodeError('Invalid workspace');
  const workspace = getWorkspace(workspaceId);
  if (project.kind !== 'project' || workspace.project_id !== projectId || workspace.status === 'removed')
    throw new CodeError('Workspace not found', 404);
  if (workspace.status !== 'ready') throw new CodeError(workspace.error || 'Workspace is not ready', 409);
  return workspace.path;
}
