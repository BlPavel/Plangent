import { getTask } from '../tasks';
import { activeWorkspace, getWorkspace, listWorkspaces } from '../workspaces';
import { getProject } from '../projects';
import { listSessions } from '../agents';
import { getQueue, isFrozen } from '../execution';
import { executeGitOperation } from '../git';
import { branches, changedFiles, repositoryInfo } from '../../infrastructure/git/read';
import { serializeGit, switchBranch, createBranch, runGit } from '../../infrastructure/git/write';
import { saveWorkBranch } from '../../infrastructure/db/repositories/work/branch';
import { broadcast } from '../shared';
import { DomainError } from '../../models/domain-error';
import { withWorkStart } from './start';

export async function changeWorkBranch(projectId: string, taskId: string,
  input: { branch: string; create?: boolean; base?: string }, signal?: AbortSignal) {
  return withWorkStart(taskId, async () => {
    const task = getTask(taskId), project = getProject(projectId), workspace = activeWorkspace(taskId);
    if (!task || task.project_id !== projectId || !project || project.kind !== 'project')
      throw new DomainError('Task not found', 404);
    if (!workspace || workspace.status !== 'ready') throw new DomainError('Рабочая папка задачи не готова', 409);
    if (!input || typeof input.branch !== 'string' || !input.branch.trim()
      || input.create !== undefined && typeof input.create !== 'boolean'
      || input.base !== undefined && typeof input.base !== 'string') throw new DomainError('Выберите ветку');
    const branch = input.branch.trim();
    const target = input.create ? branch : branch.replace(/^origin\//, '');
    if (target.startsWith('-') || target === 'HEAD' || /[\r\n\0]/.test(target)) throw new DomainError('Некорректное имя ветки');
    const assertIdle = () => {
      const current = getTask(taskId);
      if (!current || current.status === 'done' || current.closed_at) throw new DomainError('Работа закрыта', 409);
      if (activeWorkspace(taskId)?.id !== workspace.id || getWorkspace(workspace.id).status !== 'ready')
        throw new DomainError('Рабочая папка задачи изменилась', 409);
      if (isFrozen(getQueue(taskId, projectId)) || listSessions(projectId).some(s =>
        (s.task_id === taskId || s.metadata.workspace_id === workspace.id)
        && ['starting', 'thinking', 'waiting'].includes(s.status)))
        throw new DomainError('Остановите очередь и агентов перед сменой ветки', 409);
    };
    assertIdle();
    const result = await executeGitOperation({ projectId, root: workspace.path, signal }, (_root, options) =>
      serializeGit(project.repo_path, () => serializeGit(workspace.path, async () => {
        const check = () => { options.assertIdle?.(); assertIdle(); };
        check();
        const current = await repositoryInfo(workspace.path);
        if (!current?.branch) throw new DomainError('Текущая ветка не определена', 409);
        const persist = async () => {
          const selected = (await repositoryInfo(workspace.path))?.branch;
          if (selected && (selected !== getWorkspace(workspace.id).branch || selected !== getTask(taskId)?.branch_name)) {
            saveWorkBranch(taskId, workspace.id, selected);
            broadcast({ type: 'workspace:update', projectId, workspace: getWorkspace(workspace.id) });
            broadcast({ type: 'task_updated', taskId, projectId });
          }
        };
        if (!input.create && target === current.branch) {
          await persist();
          return { task: getTask(taskId)!, workspace: getWorkspace(workspace.id) };
        }
        if ((await changedFiles(workspace.path)).length)
          throw new DomainError('Сначала сохраните незакоммиченные изменения: сделайте коммит или уберите их в stash', 409);
        if (listWorkspaces(projectId).some(w => w.id !== workspace.id && w.branch === target))
          throw new DomainError('Ветка уже закреплена за другой задачей', 409);
        const occupied = await runGit(project.repo_path, ['worktree', 'list', '--porcelain'], options);
        if (target !== current.branch && occupied.split('\n').includes('branch refs/heads/' + target))
          throw new DomainError('Ветка уже открыта в другой рабочей папке', 409);
        const checkedOptions = { ...options, assertIdle: check };
        try {
          if (input.create) await createBranch(workspace.path, target, input.base?.trim() || current.branch, checkedOptions);
          else {
            const refs = await branches(workspace.path);
            const reference = refs.some(ref => ref.name === branch) ? branch : 'origin/' + target;
            await switchBranch(workspace.path, reference, checkedOptions);
          }
        } finally {
          // A hook failure or late cancellation can arrive after Git has already switched.
          await persist();
        }
        return { task: getTask(taskId)!, workspace: getWorkspace(workspace.id) };
      })));
    return result.output;
  });
}
