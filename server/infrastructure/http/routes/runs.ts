import { typedRoutes } from '../typed-route';
import { createPlannerSession } from '../../../core/orchestration/planner-session';
import { getPlanFilePath } from '../../../core/orchestration/task-files';
import { Router, Request, Response } from 'express';
import { listRuns, getRun, createRun, updateRun, addCompletedStep, finishRun } from '../../../core/runs';
import { getTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
import { getLatestPlan } from '../../../core/orchestration/plans';
import { getAgent } from '../../../core/agents';
import { resolvePlanTemplate } from '../../../core/library/plan-template';
import { buildPrompt, EXECUTION_REPORT } from '../../../core/orchestration/prompts';
import { createSession as createChat, listSessions as listChats, getSession as getChat } from '../../../core/agent-sessions/sessions';
import { sendPrompt, closeSession, startSession } from '../../../core/agent-sessions/acp-host';
import { materializePlanFile, watchPlanFile, watchPlanDirForCreate } from '../../../core/orchestration/plan-file';

export const runsRouter = Router({ mergeParams: true });
const runsRouterRoutes = typedRoutes(runsRouter, '/api/projects/:projectId/tasks/:taskId/runs');

runsRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/runs', (req, res) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json(listRuns(t.id));
});

runsRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/runs/:runId', (req, res) => {
  const r = getRun(req.params.runId);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// POST — start new agent run (direct, without orchestrator)
runsRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/runs', async (req, res) => {
  const { projectId, taskId } = req.params;

  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const task = getTask(taskId);
  if (!task || task.project_id !== projectId) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'done') return res.status(409).json({ error: 'Завершённая задача доступна только для чтения' });

  const agentId: string = req.body.agent_id ?? project.default_agent_id ?? '';
  const baseAgent = getAgent(agentId);
  if (!baseAgent) return res.status(400).json({ error: `Agent not found: ${agentId}` });
  const agent = {
    ...baseAgent,
    model: req.body.model || baseAgent.model,
    reasoning_effort: req.body.reasoning_effort || baseAgent.reasoning_effort,
  };

  const purpose: 'analysis' | 'plan' | 'execute' | 'preflight' | 'architecture' | 'qa' =
    req.body.purpose === 'architecture' ? 'architecture' : req.body.purpose === 'qa' ? 'qa' : req.body.purpose === 'analysis' ? 'analysis' : req.body.purpose === 'plan' ? 'plan' : req.body.purpose === 'preflight' ? 'preflight' : 'execute';
  const latestPlan = getLatestPlan(task.id);
  const previousRuns = listRuns(task.id);
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
    runHistory: previousRuns
      .filter(r => r.status === 'completed' || r.status === 'interrupted')
      .map(r => ({ agent: r.agent_name, date: r.started_at, completed: r.completed_steps, notes: r.notes })),
  });

  const run = createRun({ task_id: task.id, plan_id: latestPlan?.id, agent_id: agent.id, agent_name: agent.name });
  const sessionId = `plangent-${task.key.replace(/[^a-zA-Z0-9]/g, '-')}-${run.id.slice(0, 8)}`;

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
      const { mode, config } = req.body;
      const chat = (purpose === 'plan' ? createPlannerSession : createChat)({ project_id: projectId, task_id: taskId, run_id: run.id, agent_id: agent.id, role: purpose === 'analysis' ? 'analyst' : purpose === 'plan' ? 'planner' : 'material-author', policy: 'read-only',
        model: agent.model, title: task.key + ' · ' + (purpose === 'analysis' ? 'Анализ' : purpose === 'plan' ? 'Планирование' : purpose === 'qa' ? 'QA' : 'Архитектура'), metadata: { briefing: prompt, reasoningEffort: agent.reasoning_effort,
          ...(purpose === 'architecture' || purpose === 'qa' ? { material_type: purpose } : {}),
          ...(typeof mode === 'string' && mode ? { preferredMode: mode } : {}),
          ...(config && typeof config === 'object' ? { preferredConfig: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, String(v)])) } : {}) } });
      void startSession(chat.id).catch(() => {});
      return res.status(201).json({ run, session_id: chat.id, mode: 'acp' });
    }
    const chat = createChat({ project_id: projectId, task_id: taskId, run_id: run.id, agent_id: agent.id,
      role: 'executor', policy: purpose === 'preflight' ? 'read-only' : 'allow-all',
      model: agent.model, title: task.key + ' · Выполнение' });
    await sendPrompt(chat.id, [{ type: 'text', text: prompt + (purpose === 'execute' ? EXECUTION_REPORT : '') }]);
    res.status(201).json({ run, session_id: chat.id, mode: 'acp', prompt });
  } catch (err) {
    finishRun(run.id, 'failed', String(err));
    res.status(500).json({ error: 'Failed to start agent', detail: String(err) });
  }
});

runsRouterRoutes.json('PATCH /api/projects/:projectId/tasks/:taskId/runs/:runId', (req, res) => {
  const r = updateRun(req.params.runId, req.body);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

runsRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/runs/:runId/step', (req, res) => {
  const { step } = req.body;
  if (!step) return res.status(400).json({ error: 'step required' });
  const r = addCompletedStep(req.params.runId, step);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

runsRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/runs/:runId/finish', async (req, res) => {
  const { status, notes } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  const r = finishRun(req.params.runId, status, notes);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Persistent ACP sessions can be reattached after navigating away.
runsRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/runs/:runId/session', (req, res) => {
  const chat = listChats(req.params.projectId).find(s => s.run_id === req.params.runId);
  res.json(chat ? { running: true, session_id: chat.id, mode: 'acp', output: '' } : { running: false });
});
runsRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/runs/:runId/input', async (req, res) => {
  try { const chat = listChats(req.params.projectId).find(s => s.run_id === req.params.runId); if (!chat) return res.status(404).end();
    await sendPrompt(chat.id, [{ type: 'text', text: req.body.text ?? '' }]); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
runsRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/runs/:runId/kill', async (req, res) => {
  const chat = listChats(req.params.projectId).find(s => s.run_id === req.params.runId);
  if (chat) await closeSession(chat.id);
  finishRun(req.params.runId, 'interrupted', 'Прерван пользователем'); res.json({ ok: true });
});
