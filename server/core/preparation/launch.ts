import { DomainError } from '../../models/domain-error';
import type { RunsPOSTBody } from '@contracts';
import { agentPreferences } from '../agents';
import { createPlannerSession } from './planner-session';
import { getPlanFilePath } from '../tasks';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getLatestPlan } from './plans';
import { selectAgent } from '../agents';
import { resolvePlanTemplate } from '../library';
import { buildPrompt, EXECUTION_REPORT } from './prompts';
import { createAgentSession as createChat, runAgentWork, onAgentEvent, getSession, markAgentWorkFinished } from '../agents';
import { materializePlanFile, watchPlanFile, watchPlanDirForCreate } from './plan-file';


export async function launchTaskAgent(projectId: string, taskId: string, input: RunsPOSTBody) {

  const project = getProject(projectId);
  if (!project) throw new DomainError('Project not found', 404);

  const task = getTask(taskId);
  if (!task || task.project_id !== projectId) throw new DomainError('Task not found', 404);
  if (task.status === 'done') throw new DomainError('Завершённая задача доступна только для чтения', 409);

  const agentId: string = input.agent_id ?? project.default_agent_id ?? '';
  const baseAgent = selectAgent(projectId, { explicit: input.agent_id });
  if (!baseAgent) throw new DomainError('Agent not found: ' + agentId, 400);
  const agent = {
    ...baseAgent,
    model: input.model || baseAgent.model,
    reasoning_effort: input.reasoning_effort || baseAgent.reasoning_effort,
  };

  const purpose: 'analysis' | 'plan' | 'execute' | 'preflight' | 'architecture' | 'qa' =
    input.purpose === 'architecture' ? 'architecture' : input.purpose === 'qa' ? 'qa' : input.purpose === 'analysis' ? 'analysis' : input.purpose === 'plan' ? 'plan' : input.purpose === 'preflight' ? 'preflight' : 'execute';
  const latestPlan = getLatestPlan(task.id);
  const planFilePath = getPlanFilePath(project.repo_path, task.key);

  const prompt = buildPrompt({
    taskId: task.id, repoPath: project.repo_path,
    projectName: project.name,
    taskKey: task.key,
    taskTitle: task.title ?? undefined,
    taskDescription: task.description ?? undefined,
    planContent: latestPlan?.content,
    planFilePath,
    planTemplate: resolvePlanTemplate(projectId),
    purpose,
  });


  // Wire plan-file watching. The planner saves through submit_plan, which writes the file itself.
  if (purpose === 'plan' || purpose === 'preflight') {
    if (latestPlan) {
      materializePlanFile(task, latestPlan, project.repo_path);
      watchPlanFile(task, latestPlan.id, project.repo_path);
    } else if (purpose === 'preflight') {
      watchPlanDirForCreate(task, project.repo_path);
    }
  }

  try {
    if (purpose === 'plan' || purpose === 'analysis' || purpose === 'architecture' || purpose === 'qa') {
      // Nothing is sent yet: the briefing goes out, hidden, with the developer's first message.
      const { mode, config } = input;
      const chat = (purpose === 'plan' ? createPlannerSession : createChat)({ project_id: projectId, task_id: taskId, agent_id: agent.id, role: purpose === 'analysis' ? 'analyst' : purpose === 'plan' ? 'planner' : 'material-author', policy: 'read-only',
        model: agent.model, title: task.key + ' · ' + (purpose === 'analysis' ? 'Анализ' : purpose === 'plan' ? 'Планирование' : purpose === 'qa' ? 'QA' : 'Архитектура'), metadata: { briefing: prompt, reasoningEffort: agent.reasoning_effort,
          ...(purpose === 'architecture' || purpose === 'qa' ? { material_type: purpose } : {}),
          ...agentPreferences(mode, config) } });
      void runAgentWork(chat.id).catch(() => {});
      return { session_id: chat.id, mode: 'acp' as const };
    }
    const chat = createChat({ project_id: projectId, task_id: taskId, agent_id: agent.id,
      role: 'executor', policy: purpose === 'preflight' ? 'read-only' : 'allow-all',
      metadata: { taskLaunchPurpose: purpose },
      model: agent.model, title: task.key + ' · Выполнение' });
    await runAgentWork(chat.id, [{ type: 'text', text: prompt + (purpose === 'execute' ? EXECUTION_REPORT : '') }]);
    return { session_id: chat.id, mode: 'acp' as const, prompt };
  } catch (err) {
    throw new DomainError('Failed to start agent: ' + String(err), 500);
  }
}

onAgentEvent('turn_end', id => {
  if (getSession(id).metadata.taskLaunchPurpose === 'preflight') markAgentWorkFinished(id);
});
