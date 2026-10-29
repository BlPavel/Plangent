import fs from 'node:fs/promises';
import path from 'node:path';
import { getProject } from '../projects';
import { getTask } from '../tasks';
import { CodeError } from '../code/files';
import { runGit, serializeGit, fetchRepository, type GitOperationOptions } from '../code/git-write';
import { localBranchHead } from '../code/git';
import { activeWorkspace, getWorkspace, insertWorkspace, listWorkspaces, updateWorkspace, workspaceFolder } from './store';
import { prepareWorkspace } from './prepare';
export * from './roots';
export * from './store';
export { prepareWorkspace } from './prepare';

function context(taskId: string) {
  const task = getTask(taskId), project = task && getProject(task.project_id);
  if (!task || !project || project.kind !== 'project') throw new CodeError('Workspaces require an ordinary project', 409);
  return { task, project };
}
async function validBranch(root: string, branch: string) {
  if (!branch || branch.startsWith('-')) throw new CodeError('Invalid branch');
  await runGit(root, ['check-ref-format', '--branch', branch]);
}
export async function createWorkspace(taskId: string, input: { branch: string; base: string }, options: GitOperationOptions = {}) {
  const { task, project } = context(taskId), root = project.repo_path;
  return serializeGit(root, async () => {
    await validBranch(root, input.branch);
    await validBranch(root, input.base.replace(/^origin\//, ''));
    if (activeWorkspace(taskId)) throw new CodeError('Task already has an active workspace', 409);
    const owner = listWorkspaces(project.id).find(w => w.branch === input.branch);
    if (owner) throw new CodeError('Ветка уже в работе у ' + (getTask(owner.task_id)?.key ?? owner.task_id), 409);
    const occupied = await runGit(root, ['worktree', 'list', '--porcelain'], options);
    if (occupied.split('\n').includes('branch refs/heads/' + input.branch)) throw new CodeError('Ветка уже используется в другом рабочем месте', 409);
    const destination = workspaceFolder(project.id, task.key);
    if (await fs.lstat(destination).then(() => true, () => false)) throw new CodeError('Workspace folder already exists', 409);
    await fetchRepository(root, options);
    const existing = await localBranchHead(root, input.branch);
    // A branch that exists only in origin (pushed from elsewhere) is checked out as its local tracking copy.
    const remoteOnly = !existing && await runGit(root, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/' + input.branch], options).then(() => true, () => false);
    const remoteBase = 'refs/remotes/origin/' + input.base.replace(/^origin\//, '');
    const hasRemoteBase = await runGit(root, ['show-ref', '--verify', '--quiet', remoteBase], options).then(() => true, () => false);
    const base = hasRemoteBase ? remoteBase : 'refs/heads/' + input.base.replace(/^origin\//, '');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const workspace = insertWorkspace({ project_id: project.id, task_id: taskId, branch: input.branch, base_branch: input.base, path: destination });
    try {
      await runGit(root, existing ? ['worktree', 'add', '--', destination, input.branch]
        : remoteOnly ? ['worktree', 'add', '--track', '-b', input.branch, '--', destination, 'origin/' + input.branch]
        : ['worktree', 'add', '-b', input.branch, '--', destination, base], options);
      return await prepareWorkspace(workspace.id, { signal: options.signal });
    } catch (error) {
      updateWorkspace(workspace.id, { status: 'failed', error: String(error) });
      throw error;
    }
  });
}

export interface WorkspaceRemovalBlockers { files: string[]; commits: string[] }
export class WorkspaceRemovalError extends CodeError {
  constructor(public blockers: WorkspaceRemovalBlockers) { super('Рабочее место содержит изменения или непереданные коммиты', 409); }
}
export async function removalBlockers(id: string): Promise<WorkspaceRemovalBlockers> {
  const workspace = getWorkspace(id), { project } = context(workspace.task_id);
  const present = await fs.lstat(workspace.path).then(() => true, () => false);
  const files = present ? (await runGit(workspace.path, ['status', '--porcelain', '-z', '--untracked-files=all', '--ignored=matching'])).split('\0').filter(Boolean) : [];
  const remotes = (await runGit(project.repo_path, ['for-each-ref', '--format=%(refname)', 'refs/remotes/'])).trim().split('\n').filter(Boolean);
  const base = 'refs/heads/' + workspace.base_branch.replace(/^origin\//, '');
  const exists = await localBranchHead(project.repo_path, workspace.branch);
  const commits = (exists ? await runGit(project.repo_path, ['rev-list', 'refs/heads/' + workspace.branch, '--not', ...(remotes.length ? remotes : [base])]) : '')
    .trim().split('\n').filter(Boolean);
  return { files, commits };
}
export async function removeWorkspace(id: string, input: { discard?: boolean; keepBranch?: boolean } = {}, options: GitOperationOptions = {}) {
  const workspace = getWorkspace(id), { project, task } = context(workspace.task_id);
  return serializeGit(project.repo_path, async () => {
    if (getWorkspace(id).status === 'removed') return getWorkspace(id);
    // Never pass arbitrary persisted paths to worktree remove.
    if (path.resolve(workspace.path) !== workspaceFolder(project.id, task.key)) throw new CodeError('Invalid workspace path');
    const blockers = await removalBlockers(id);
    if (!input.discard && (blockers.files.length || blockers.commits.length)) throw new WorkspaceRemovalError(blockers);
    if (await fs.lstat(workspace.path).then(() => true, () => false)) {
      await runGit(project.repo_path, ['worktree', 'remove', ...(input.discard ? ['--force'] : []), '--', workspace.path], options);
    }
    await runGit(project.repo_path, ['worktree', 'prune'], options);
    if (input.discard && !input.keepBranch && await localBranchHead(project.repo_path, workspace.branch)) {
      await runGit(project.repo_path, ['branch', '-D', '--', workspace.branch], options);
    }
    return updateWorkspace(id, { status: 'removed', removed_at: new Date().toISOString() });
  });
}
/** Reuse the branch and its commits; only replace the working folder after the usual safety checks. */
export async function recreateWorkspace(id: string, input: { discard?: boolean } = {}, options: GitOperationOptions = {}) {
  const workspace = getWorkspace(id), { project } = context(workspace.task_id);
  return serializeGit(project.repo_path, async () => {
    await removeWorkspace(id, { ...input, keepBranch: true }, options);
    return createWorkspace(workspace.task_id, { branch: workspace.branch, base: workspace.base_branch }, options);
  });
}
