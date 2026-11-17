import fs from 'node:fs/promises';
import path from 'node:path';
import { getProject } from '../projects';
import { getTask } from '../tasks';
import type { Workspace } from '../../models';
import { DomainError } from '../../models/domain-error';
import { runGit, serializeGit, fetchRepository, type GitOperationOptions } from '../../infrastructure/git/write';
import { localBranchHead } from '../../infrastructure/git/read';
import { activeWorkspace, getWorkspace, insertWorkspace, listWorkspaces, updateWorkspace, workspaceFolder } from './store';
import { openWorkspace, prepareWorkspace } from './prepare';
import { allocatePortSlot } from './ports';
export * from './roots';
export * from './store';
export { prepareWorkspace } from './prepare';
export { workspaceEnv, PORT_STEP } from './ports';

function context(taskId: string) {
  const task = getTask(taskId), project = task && getProject(task.project_id);
  if (!task || !project || project.kind !== 'project') throw new DomainError('Workspaces require an ordinary project', 409);
  return { task, project };
}
async function validBranch(root: string, branch: string) {
  if (!branch || branch.startsWith('-')) throw new DomainError('Invalid branch');
  await runGit(root, ['check-ref-format', '--branch', branch]);
}
export async function createWorkspace(taskId: string, input: { branch: string; base: string; portSlot?: number }, options: GitOperationOptions = {}) {
  const { task, project } = context(taskId), root = project.repo_path;
  return serializeGit(root, async () => {
    await validBranch(root, input.branch);
    await validBranch(root, input.base.replace(/^origin\//, ''));
    if (activeWorkspace(taskId)) throw new DomainError('Task already has an active workspace', 409);
    const owner = listWorkspaces(project.id).find(w => w.branch === input.branch);
    if (owner) throw new DomainError('Ветка уже в работе у ' + (getTask(owner.task_id)?.key ?? owner.task_id), 409);
    const occupied = await runGit(root, ['worktree', 'list', '--porcelain'], options);
    if (occupied.split('\n').includes('branch refs/heads/' + input.branch)) throw new DomainError('Ветка уже используется в другом рабочем месте', 409);
    const destination = workspaceFolder(project.id, task.key);
    if (await fs.lstat(destination).then(() => true, () => false)) throw new DomainError('Workspace folder already exists', 409);
    await fetchRepository(root, options);
    const existing = await localBranchHead(root, input.branch);
    // A branch that exists only in origin (pushed from elsewhere) is checked out as its local tracking copy.
    const remoteOnly = !existing && await runGit(root, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/' + input.branch], options).then(() => true, () => false);
    const remoteBase = 'refs/remotes/origin/' + input.base.replace(/^origin\//, '');
    const hasRemoteBase = await runGit(root, ['show-ref', '--verify', '--quiet', remoteBase], options).then(() => true, () => false);
    const base = hasRemoteBase ? remoteBase : 'refs/heads/' + input.base.replace(/^origin\//, '');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const port_slot = await allocatePortSlot(project.id, input.portSlot);
    const workspace = insertWorkspace({ project_id: project.id, task_id: taskId, branch: input.branch, base_branch: input.base, path: destination, port_slot });
    try {
      await runGit(root, existing ? ['worktree', 'add', '--', destination, input.branch]
        : remoteOnly ? ['worktree', 'add', '--track', '-b', input.branch, '--', destination, 'origin/' + input.branch]
        : ['worktree', 'add', '-b', input.branch, '--', destination, base], options);
      options.signal?.throwIfAborted();
      return openWorkspace(workspace.id);
    } catch (error) {
      updateWorkspace(workspace.id, { status: 'failed', error: String(error) });
      throw error;
    }
  });
}

const setups = new Map<string, Promise<Workspace>>();
/**
 * Prepares the task's workspace once, when its work really starts: later calls (or concurrent ones) find it set up.
 * The folder stays usable meanwhile; callers that need the result (commands) await it, the rest start it and go on.
 */
export async function ensureWorkspaceSetup(taskId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  const workspace = activeWorkspace(taskId);
  if (!workspace || workspace.setup_done) return;
  if (workspace.status !== 'ready') throw new DomainError(workspace.error || 'Workspace is not ready', 409);
  let running = setups.get(workspace.id);
  if (!running) {
    running = prepareWorkspace(workspace.id, { signal: options.signal, background: true }).finally(() => setups.delete(workspace.id));
    setups.set(workspace.id, running);
  }
  const result = await running;
  if (!result.setup_done) throw new DomainError('Подготовка рабочего места не удалась: ' + result.error, 409);
}

export interface WorkspaceRemovalBlockers { files: string[]; commits: string[] }
export class WorkspaceRemovalError extends DomainError {
  constructor(public blockers: WorkspaceRemovalBlockers) { super('Рабочее место содержит изменения или непереданные коммиты', 409); }
}
/** Uncommitted work is changed tracked files and new files git would commit; git-ignored ones (copied `.env`, dependencies, builds) go with the folder. */
export async function removalBlockers(id: string): Promise<WorkspaceRemovalBlockers> {
  const workspace = getWorkspace(id), { project } = context(workspace.task_id);
  const present = await fs.lstat(workspace.path).then(() => true, () => false);
  const files = present ? (await runGit(workspace.path, ['status', '--porcelain', '-z', '--untracked-files=all'])).split('\0').filter(Boolean) : [];
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
    if (path.resolve(workspace.path) !== workspaceFolder(project.id, task.key)) throw new DomainError('Invalid workspace path');
    const blockers = await removalBlockers(id);
    // A kept branch keeps its unpushed commits: only uncommitted files would be lost.
    if (!input.discard && (blockers.files.length || !input.keepBranch && blockers.commits.length)) throw new WorkspaceRemovalError(blockers);
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
    const created = await createWorkspace(workspace.task_id, { branch: workspace.branch, base: workspace.base_branch, portSlot: workspace.port_slot }, options);
    // A workspace that was already prepared comes back prepared.
    if (!workspace.setup_done) return created;
    void ensureWorkspaceSetup(workspace.task_id).catch(() => {});
    return getWorkspace(created.id);
  });
}

export { rootForViewing } from './viewing';
export { configureDependencies as configureWorkspacesDependencies } from './dependencies';
