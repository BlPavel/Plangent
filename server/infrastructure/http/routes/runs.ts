import { Router, Request, Response } from 'express';
import { listRuns, getRun, createRun, updateRun, addCompletedStep, finishRun } from '../../../core/runs';
import { getTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
import { getLatestPlan } from '../../../core/orchestration/plans';
import { getAgent } from '../../../core/agents';
import { resolvePlanTemplate } from '../../../core/library/plan-template';
import { buildPrompt, EXECUTION_REPORT } from '../../../core/orchestration/prompts';
import { createSession as createChat, listSessions as listChats, getSession as getChat } from '../../../core/agent-sessions/sessions';
import { sendPrompt, closeSession } from '../../../core/agent-sessions/acp-host';
import { getPlanFilePath, materializePlanFile, watchPlanFile, watchPlanDirForCreate } from '../../../core/orchestration/plan-file';
import { getOrchestrator } from '../../../core/orchestration/orchestrator';

export const runsRouter = Router({ mergeParams: true });

runsRouter.get('/', (req: Request, res: Response) => {
  const t = getTask(req.params.taskId);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json(listRuns(t.id));
});

runsRouter.get('/:runId', (req: Request, res: Response) => {
  const r = getRun(req.params.runId);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// POST — start new agent run (direct, without orchestrator)
runsRouter.post('/', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;

  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const task = getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const agentId: string = req.body.agent_id ?? project.default_agent_id ?? '';
  const baseAgent = getAgent(agentId);
  if (!baseAgent) return res.status(400).json({ error: `Agent not found: ${agentId}` });
  const agent = {
    ...baseAgent,
    model: req.body.model || baseAgent.model,
    reasoning_effort: req.body.reasoning_effort || baseAgent.reasoning_effort,
  };

  const purpose: 'plan' | 'execute' | 'preflight' =
    req.body.purpose === 'plan' ? 'plan' : req.body.purpose === 'preflight' ? 'preflight' : 'execute';
  const latestPlan = getLatestPlan(task.id);
  const previousRuns = listRuns(task.id);
  const planFilePath = getPlanFilePath(project.repo_path, task.key);

  const prompt = buildPrompt({
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

  // Wire plan-file watching
  if (purpose === 'plan' || purpose === 'preflight') {
    if (latestPlan) {
      materializePlanFile(task, latestPlan, project.repo_path);
      watchPlanFile(task, latestPlan.id, project.repo_path);
    } else {
      watchPlanDirForCreate(task, project.repo_path);
    }
  }

  try {
    const chat = createChat({ project_id: projectId, task_id: taskId, run_id: run.id, agent_id: agent.id,
      role: purpose === 'plan' ? 'planner' : 'executor', policy: purpose === 'preflight' ? 'read-only' : purpose === 'plan' ? 'ask' : 'allow-all',
      model: agent.model, title: task.key + (purpose === 'plan' ? ' · Планирование' : ' · Выполнение') });
    await sendPrompt(chat.id, [{ type: 'text', text: prompt + (purpose === 'execute' ? EXECUTION_REPORT : '') }]);
    res.status(201).json({ run, session_id: chat.id, mode: 'acp', prompt });
  } catch (err) {
    finishRun(run.id, 'failed', String(err));
    res.status(500).json({ error: 'Failed to start agent', detail: String(err) });
  }
});

runsRouter.patch('/:runId', (req: Request, res: Response) => {
  const r = updateRun(req.params.runId, req.body);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

runsRouter.post('/:runId/step', (req: Request, res: Response) => {
  const { step } = req.body;
  if (!step) return res.status(400).json({ error: 'step required' });
  const r = addCompletedStep(req.params.runId, step);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

runsRouter.post('/:runId/finish', async (req: Request, res: Response) => {
  const { status, notes } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  const r = finishRun(req.params.runId, status, notes);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Persistent ACP sessions can be reattached after navigating away.
runsRouter.get('/:runId/session', (req: Request, res: Response) => {
  const chat = listChats(req.params.projectId).find(s => s.run_id === req.params.runId);
  res.json(chat ? { running: true, session_id: chat.id, mode: 'acp', output: '' } : { running: false });
});
runsRouter.post('/:runId/input', async (req: Request, res: Response) => {
  try { const chat = listChats(req.params.projectId).find(s => s.run_id === req.params.runId); if (!chat) return res.status(404).end();
    await sendPrompt(chat.id, [{ type: 'text', text: req.body.text }]); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
runsRouter.post('/:runId/kill', async (req: Request, res: Response) => {
  const chat = listChats(req.params.projectId).find(s => s.run_id === req.params.runId);
  if (chat) await closeSession(chat.id);
  finishRun(req.params.runId, 'interrupted', 'Прерван пользователем'); res.json({ ok: true });
});
