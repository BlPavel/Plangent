import { randomUUID } from 'node:crypto';
import { getTask, updateTask } from '../tasks';
import { getProject, effectiveGitSettings } from '../projects';
import { activeWorkspace, createWorkspace, assertTaskWorkspaceReady } from '../workspaces';
import { slugify } from '../shared/slugify';
import { CodeError } from '../code/files';

const starting = new Set<string>();
export async function withWorkStart<T>(taskId: string, action: () => Promise<T>): Promise<T> {
  if (starting.has(taskId)) throw new CodeError('Работа уже запускается', 409);
  starting.add(taskId);
  try { return await action(); } finally { starting.delete(taskId); }
}
export async function prepareWork(taskId: string, input: { base_branch?: string; branch_name?: string } = {}) {
  const task = getTask(taskId), project = task && getProject(task.project_id);
  if (!task || !project) throw new CodeError('Task not found', 404);
  if (project.kind !== 'project') return;
  if (activeWorkspace(taskId)) { assertTaskWorkspaceReady(taskId); return; }
  const settings = effectiveGitSettings(project.id).values;
  const base = input.base_branch || task.base_branch || settings.base_branch;
  if (!base) throw new CodeError('Выберите базовую ветку', 400);
  const branch = input.branch_name || task.branch_name || (settings.branch_prefixes[0] || 'feature') + '/' + slugify(task.external_key || task.title || task.key).slice(0, 80) + '-' + randomUUID().slice(0, 8);
  await createWorkspace(taskId, { branch, base });
  assertTaskWorkspaceReady(taskId);
  updateTask(taskId, { branch_name: branch, base_branch: base });
}
