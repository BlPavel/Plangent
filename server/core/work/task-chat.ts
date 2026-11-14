import { createAgentSession, listSessions, closeSession } from '../agents';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { selectAgent } from '../agents';
import { assertTaskWorkspaceReady, activeWorkspace } from '../workspaces';
import { withWorkStart } from './start';
import { DomainError } from '../../models/domain-error';

export const TASK_CHAT_BRIEFING = 'You are the task follow-up agent: you fix the developer\'s review remarks and answer questions about this task\'s changes in this chat. '
  + 'Call get_task_context when you need the task, plan, analysis, executor reports or the changed files; read only what the remark needs. '
  + 'When a message announces a review round, call get_review, start_review_item, and reply_review_item. Do not mark plan steps complete. Respond in the developer’s language, Russian by default.';

export interface TaskChatOptions {
  /** Start a fresh follow-up agent even though one exists (its context is full or the developer wants another agent). */
  replace?: boolean;
  model?: string;
  reasoningEffort?: string;
}
/**
 * The follow-up agent of a task. The newest one takes every round; none yet — it is created from the agent of the
 * task's latest executor (or the project's agent). A task's agent is changed with `replace`: the old chat stays as a journal.
 */
export async function taskChat(taskId: string, agentId?: string, options: TaskChatOptions = {}) {
  return withWorkStart(taskId, async () => {
    const task = getTask(taskId), project = task && getProject(task.project_id);
    if (!task || !project) throw new DomainError('Task not found', 404);
    if (task.closed_at || task.status === 'done') throw new DomainError('Работа закрыта', 409);
    assertTaskWorkspaceReady(taskId);
    const sessions = listSessions(project.id).filter(s => s.task_id === taskId); // newest first
    const existing = sessions.find(s => s.role === 'errand' || s.role === 'task-chat');
    if (task.kind === 'errand') {
      if (!existing) throw new DomainError('Чат поручения не найден', 409);
      return existing;
    }
    if (existing && !options.replace) return existing;
    if (existing && ['starting', 'thinking', 'waiting'].includes(existing.status)) throw new DomainError('Агент ещё работает: дождитесь конца хода', 409);
    const agent = selectAgent(project.id, { explicit: agentId, saved: sessions.find(s => s.role === 'executor')?.agent_id });
    if (!agent) throw new DomainError('Выберите агента');
    if (existing) await closeSession(existing.id);
    const model = options.model || agent.model, effort = options.reasoningEffort || agent.reasoning_effort;
    return createAgentSession({ project_id: project.id, task_id: taskId, agent_id: agent.id, model,
      role: 'task-chat', policy: 'allow-all', title: task.key + ' · Агент исправлений',
      metadata: { workspace_id: activeWorkspace(taskId)?.id, reasoningEffort: effort, briefing: TASK_CHAT_BRIEFING } });
  });
}
