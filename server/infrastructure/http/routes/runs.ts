import { Router, Request, Response } from 'express';
import { listRuns, getRun, createRun, updateRun, addCompletedStep, finishRun } from '../../../core/runs';
import { getTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
import { getLatestPlan } from '../../../core/orchestration/plans';
import { getAgent } from '../../../core/agents';
import { buildPrompt, launchAgent, sendToAgent, killAgent } from '../../adapters/generic';
import { TmuxManager } from '../../terminal/tmux';
import { getPtySession } from '../../terminal/pty-manager';
import { registerSession, getSession, removeSession } from '../../../core/sessions/session-registry';
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
  const agent = getAgent(agentId);
  if (!agent) return res.status(400).json({ error: `Agent not found: ${agentId}` });

  const purpose: 'plan' | 'execute' = req.body.purpose === 'plan' ? 'plan' : 'execute';
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
    purpose,
    runHistory: previousRuns
      .filter(r => r.status === 'completed' || r.status === 'interrupted')
      .map(r => ({ agent: r.agent_name, date: r.started_at, completed: r.completed_steps, notes: r.notes })),
  });

  const run = createRun({ task_id: task.id, plan_id: latestPlan?.id, agent_id: agent.id, agent_name: agent.name });
  const sessionId = `plangent-${task.key.replace(/[^a-zA-Z0-9]/g, '-')}-${run.id.slice(0, 8)}`;

  // Wire plan-file watching
  if (purpose === 'plan') {
    if (latestPlan) {
      materializePlanFile(task, latestPlan, project.repo_path);
      watchPlanFile(task, latestPlan.id, project.repo_path);
    } else {
      watchPlanDirForCreate(task, project.repo_path);
    }
  }

  try {
    const result = await launchAgent(agent, project.repo_path, sessionId, project.config.extra_env, prompt);
    registerSession(run.id, { sessionId, mode: result.mode, projectId, taskId });

    res.status(201).json({
      run,
      session_id: sessionId,
      mode: result.mode,
      prompt,
    });
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
  removeSession(req.params.runId);
  const r = finishRun(req.params.runId, status, notes);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// Hook callback — called by the agent (Claude Code Stop hook / Codex notify)
runsRouter.post('/:runId/agent-stopped', async (req: Request, res: Response) => {
  const { runId, taskId } = req.params;
  res.json({ ok: true });  // respond immediately so curl doesn't block the hook

  // Notify orchestrator if one is running for this task
  const orchestrator = getOrchestrator(taskId);
  if (orchestrator) {
    try {
      await orchestrator.onAgentStopped(runId);
    } catch (e) {
      console.error('[runs] orchestrator.onAgentStopped error:', e);
    }
  }
});

// GET session status / output
runsRouter.get('/:runId/session', async (req: Request, res: Response) => {
  const session = getSession(req.params.runId);
  if (!session) return res.json({ running: false });

  if (session.mode === 'tmux') {
    const tmux = new TmuxManager(session.sessionId);
    const exists = await tmux.exists();
    const output = exists ? await tmux.capturePane() : '';
    return res.json({ running: exists, session_id: session.sessionId, mode: 'tmux', output });
  } else {
    const s = getPtySession(session.sessionId);
    return res.json({ running: !!s, session_id: session.sessionId, mode: 'pty' });
  }
});

// POST send input to running agent
runsRouter.post('/:runId/input', async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const session = getSession(req.params.runId);
  if (!session) return res.status(400).json({ error: 'No active session' });

  await sendToAgent(session.sessionId, session.mode, text);
  res.json({ ok: true });
});

// POST kill agent
runsRouter.post('/:runId/kill', async (req: Request, res: Response) => {
  const session = getSession(req.params.runId);
  if (session) {
    await killAgent(session.sessionId, session.mode);
    removeSession(req.params.runId);
  }
  finishRun(req.params.runId, 'interrupted', 'Прерван пользователем');
  res.json({ ok: true });
});
