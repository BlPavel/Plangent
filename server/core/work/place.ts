import type { ErrandPlace, ErrandReviewAgent, Project } from '../../models';
import { getTask, updateTask } from '../tasks';
import { effectiveGitSettings } from '../settings';
import { createWorkspace, assertTaskWorkspaceReady } from '../workspaces';
import { captureTaskBaseCommit } from '../git';
import { repositoryInfo } from '../../infrastructure/git/read';
import { broadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
import { prepareWork } from './start';
import { mainFolderWork } from './main-folder';

export const optional = (value: unknown, name: string) => {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new DomainError('Invalid ' + name);
  return typeof value === 'string' ? value.trim() : '';
};

/** Who reviews the work: the pick made at creation; undefined — the project's review agent. */
export function readReviewAgent(pick: unknown): ErrandReviewAgent | undefined {
  if (pick === undefined) return undefined;
  const value = pick as ErrandReviewAgent | null;
  if (!value || typeof value !== 'object' || typeof value.agent_id !== 'string') throw new DomainError('Invalid review_agent');
  return value.agent_id ? { agent_id: value.agent_id, model: optional(value.model, 'review model'), effort: optional(value.effort, 'review effort') } : undefined;
}

export interface WorkPlaceInput { place?: ErrandPlace; base_branch?: string; branch_name?: string; branch?: string }
export interface WorkPlace { place: ErrandPlace; baseBranch: string; branchName: string; branch: string }

/**
 * Where a new work goes: `new` — its own folder on a new branch from `base_branch`; `existing` — its own folder
 * on the developer's `branch` (or the main folder when that branch is open there); `main` — the project's main folder.
 */
export async function readWorkPlace(project: Project, input: WorkPlaceInput): Promise<WorkPlace> {
  const baseBranch = optional(input.base_branch, 'base_branch').replace(/^origin\//, ''), branchName = optional(input.branch_name, 'branch_name');
  let place: ErrandPlace = input.place ?? 'new';
  const branch = optional(input.branch, 'branch').replace(/^origin\//, '');
  if (!['new', 'existing', 'main'].includes(place)) throw new DomainError('Invalid place');
  if (place === 'existing' && !branch) throw new DomainError('Выберите ветку');
  // Groups work in their projects' main folders; a branch already open in the main folder is worked on there.
  if (project.kind !== 'project') place = 'main';
  else if (place === 'existing' && (await repositoryInfo(project.repo_path))?.branch === branch) place = 'main';
  if (place === 'main' && project.kind === 'project') {
    const busy = mainFolderWork(project.id);
    if (busy) throw new DomainError('В основной папке уже идёт работа «' + (busy.title || busy.external_key || busy.key) + '». Закройте её или выберите отдельную ветку.', 409);
  }
  return { place, baseBranch, branchName, branch };
}

/** Prepares the chosen place for a just created work and pins its base commit. */
export async function prepareWorkPlace(taskId: string, project: Project, { place, baseBranch, branchName, branch }: WorkPlace) {
  // A failed preparation remains visible and can be inspected/retried; never start in the main folder on failure.
  try {
    if (place === 'new') await prepareWork(taskId, { base_branch: baseBranch, branch_name: branchName });
    else if (place === 'existing') {
      const base = baseBranch || effectiveGitSettings(project.id).values.base_branch || branch;
      await createWorkspace(taskId, { branch, base });
      assertTaskWorkspaceReady(taskId);
      updateTask(taskId, { branch_name: branch, base_branch: base });
    } else if (project.kind === 'project') updateTask(taskId, { branch_name: (await repositoryInfo(project.repo_path))?.branch ?? undefined });
    if (getTask(taskId)) await captureTaskBaseCommit(taskId);
  } catch (error) { broadcast({ type: 'task_updated', taskId, projectId: project.id }); throw error; }
}
