import { getTask, updateTask } from './index';
import { getProject, effectiveGitSettings } from '../projects';
import { CodeError } from '../code/files';
import { changedFiles, branches } from '../code/git';
import { assertRepositoryIdle } from '../code/git-busy';
import { serializeGit, fetchRepository, createBranch } from '../code/git-write';
export function taskContext(projectId: string, taskId: string) {
  const task = getTask(taskId), project = getProject(projectId);
  if (!task || task.project_id !== projectId || !project || project.kind !== 'project') throw new CodeError('Task not found',404);
  return { task, project, settings: effectiveGitSettings(projectId).values };
}
export async function createTaskBranch(projectId: string, taskId: string, input: { name?: unknown; base?: unknown }) {
  const { project } = taskContext(projectId,taskId);
  if (typeof input.name !== 'string' || typeof input.base !== 'string') throw new CodeError('Выберите имя и базовую ветку');
  const name = input.name, base = input.base;
  return serializeGit(project.repo_path, async () => {
    assertRepositoryIdle(projectId);
    if ((await changedFiles(project.repo_path)).length) throw new CodeError('Есть незакоммиченные изменения. Закоммитьте или разберите их во внешнем клиенте, затем повторите создание ветки.',409);
    await fetchRepository(project.repo_path);
    const bs = await branches(project.repo_path);
    // A local base with a matching origin branch must start from the freshly fetched remote tip.
    const fresh = base.startsWith('origin/') ? base : bs.some(b => b.name === 'origin/' + base) ? 'origin/' + base : base;
    await createBranch(project.repo_path,name,fresh);
    return updateTask(taskId,{ branch_name: name, base_branch: base, status: 'in_progress' });
  });
}
