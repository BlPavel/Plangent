import { createAgentSession, listSessions } from '../agents';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { selectAgent } from '../agents';
import { getLatestPlan } from '../preparation';
import { analysisToolContext } from '../preparation';
import { repositoryInfo, taskWorktreeChanges } from '../../infrastructure/git/read';
import { activeWorkspace, rootForTask, assertTaskWorkspaceReady } from '../workspaces';
import { getQueue } from '../execution';
import { withWorkStart } from './start';
import { DomainError } from '../../models/domain-error';

export async function taskChat(taskId: string, agentId?: string) {
  return withWorkStart(taskId, async () => {
    const task = getTask(taskId), project = task && getProject(task.project_id);
    if (!task || !project) throw new DomainError('Task not found', 404);
    if (task.closed_at || task.status === 'done') throw new DomainError('Работа закрыта', 409);
    assertTaskWorkspaceReady(taskId);
    const sessions = listSessions(project.id).filter(s => s.task_id === taskId);
    const existing = sessions.find(s => s.role === 'errand' || s.role === 'task-chat');
    if (existing) return existing;
    if (task.kind === 'errand') throw new DomainError('Чат поручения не найден', 409);
    const agent = selectAgent(project.id, { explicit: agentId, saved: sessions.find(s => s.role === 'executor')?.agent_id });
    if (!agent) throw new DomainError('Выберите агента');
    const repository = await repositoryInfo(rootForTask(taskId));
    const changes = repository && task.base_commit ? await taskWorktreeChanges(rootForTask(taskId), task.base_commit) : null;
    const context = { task, plan: getLatestPlan(taskId)?.content ?? '', analysis: analysisToolContext(taskId, project.repo_path, task.key),
      executor_reports: sessions.filter(s => s.role === 'executor').map(s => ({ steps: s.step_ids, status: s.status, summary: s.reason })),
      queue: getQueue(taskId, project.id), changes };
    return createAgentSession({ project_id: project.id, task_id: taskId, agent_id: agent.id, model: agent.model,
      role: 'task-chat', policy: 'allow-all', title: task.key + ' · Чат задачи',
      metadata: { workspace_id: activeWorkspace(taskId)?.id, reasoningEffort: agent.reasoning_effort,
        briefing: 'You are the task follow-up agent. Consider the analysis, plan, executor reports, and changes. Implement the developer’s requests in this chat. When a message announces a review round, call get_review, start_review_item, and reply_review_item. Do not mark plan steps complete. Respond in the developer’s language, Russian by default. Task context:\n' + JSON.stringify(context) } });
  });
}
