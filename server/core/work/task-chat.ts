import { createSession, listSessions } from '../agent-sessions/sessions';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getAgent } from '../agents';
import { getLatestPlan } from '../orchestration/plans';
import { analysisToolContext } from '../orchestration/analysis-context';
import { repositoryInfo, taskWorktreeChanges } from '../code/git';
import { activeWorkspace, rootForTask, assertTaskWorkspaceReady } from '../workspaces';
import { getQueue } from '../orchestration/queue';
import { withWorkStart } from './start';
import { CodeError } from '../code/files';

export async function taskChat(taskId: string, agentId?: string) {
  return withWorkStart(taskId, async () => {
    const task = getTask(taskId), project = task && getProject(task.project_id);
    if (!task || !project) throw new CodeError('Task not found', 404);
    if (task.closed_at || task.status === 'done') throw new CodeError('Работа закрыта', 409);
    assertTaskWorkspaceReady(taskId);
    const sessions = listSessions(project.id).filter(s => s.task_id === taskId);
    const existing = sessions.find(s => s.role === 'errand' || s.role === 'task-chat');
    if (existing) return existing;
    if (task.kind === 'errand') throw new CodeError('Чат поручения не найден', 409);
    const agent = getAgent(agentId || sessions.find(s => s.role === 'executor')?.agent_id || project.default_agent_id || '');
    if (!agent) throw new CodeError('Выберите агента');
    const repository = await repositoryInfo(rootForTask(taskId));
    const changes = repository && task.base_commit ? await taskWorktreeChanges(rootForTask(taskId), task.base_commit) : null;
    const context = { task, plan: getLatestPlan(taskId)?.content ?? '', analysis: analysisToolContext(taskId, project.repo_path, task.key),
      executor_reports: sessions.filter(s => s.role === 'executor').map(s => ({ steps: s.step_ids, status: s.status, summary: s.reason })),
      queue: getQueue(taskId, project.id), changes };
    return createSession({ project_id: project.id, task_id: taskId, agent_id: agent.id, model: agent.model,
      role: 'task-chat', policy: 'allow-all', title: task.key + ' · Чат задачи',
      metadata: { workspace_id: activeWorkspace(taskId)?.id, reasoningEffort: agent.reasoning_effort,
        briefing: 'Ты агент доработки задачи. Учитывай анализ, план, отчёты всех исполнителей и изменения. Выполняй исправления по сообщениям пользователя в этом чате. Если сообщение сообщает о раунде ревью, вызови get_review, start_review_item и reply_review_item. Не отмечай шаги плана. Контекст задачи:\n' + JSON.stringify(context) } });
  });
}
