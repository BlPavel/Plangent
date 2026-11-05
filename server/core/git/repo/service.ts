import { rootForViewing } from '../../workspaces';
import { getProject } from '../../projects';
import { effectiveGitSettings, gitAgent } from '../../settings';
import { DomainError } from '../../../models/domain-error';
import { assertRepositoryIdle } from './git-busy';
import { trackingInfo, gitOperation, originUrl, branches } from '../../../infrastructure/git/read';
import { fetchRepository } from '../../../infrastructure/git/write';
import { inspectCommitMessage, type CommitMessageInput } from '../commits/commit-message';

export function gitRoot(projectId: string, workspace?: unknown): string {
  const project = getProject(projectId);
  if (!project || project.kind !== 'project') throw new DomainError('Project not found', 404);
  return rootForViewing(project.id, workspace);
}
export async function repositoryState(projectId: string, root: string) {
  let busyReason = '';
  try { assertRepositoryIdle(projectId, undefined, root); } catch (error) { busyReason = (error as Error).message; }
  const info = await trackingInfo(root);
  return info ? { ...info, busyReason, operation: await gitOperation(root) } : null;
}
export function gitSettings(projectId: string) {
  let agent: ReturnType<typeof gitAgent> | null = null;
  try { agent = gitAgent(projectId); } catch { /* The UI asks the developer to pick an agent. */ }
  return { ...effectiveGitSettings(projectId).values, agent };
}
export async function refreshBranches(root: string) {
  if (await originUrl(root)) await fetchRepository(root, { timeoutMs: 30000 });
  return branches(root);
}
export function inspectProjectCommitMessage(projectId: string, input: CommitMessageInput) {
  const settings = effectiveGitSettings(projectId).values;
  try { return inspectCommitMessage({ ...input, includeDescription: input?.includeDescription ?? settings.include_description }, settings); }
  catch (error) { throw new DomainError((error as Error).message); }
}
