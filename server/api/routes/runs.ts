import { Router, Request, Response } from 'express';
import { listRuns, getRun, createRun, updateRun, addCompletedStep, finishRun } from '../../storage/runs';
import { getTask } from '../../storage/tasks';
import { getProject } from '../../storage/projects';
import { getLatestPlan } from '../../storage/plans';
import { getAgent } from '../../storage/agents';
import { readCommonSkills, readProjectSkills } from '../../skills/manager';
import { buildPrompt, launchAgent, sendToAgent, killAgent, deploySkillsToProject, cleanupSkillsFromProject } from '../../adapters/generic';
import { TmuxManager } from '../../terminal/tmux';
import { getPtySession } from '../../terminal/pty-manager';

export const runsRouter = Router({ mergeParams: true });

// In-memory map: runId → { sessionId, mode, skillsFile }
const activeSessions = new Map<string, { sessionId: string; mode: 'tmux' | 'pty'; skillsFile: string | null }>();

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

// POST — start new agent run
runsRouter.post('/', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;

  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const task = getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const agentId: string = req.body.agent_id ?? project.default_agent_id ?? '';
  const agent = getAgent(agentId);
  if (!agent) return res.status(400).json({ error: `Agent not found: ${agentId}` });

  const latestPlan = getLatestPlan(task.id);
  const previousRuns = listRuns(task.id);

  const prompt = buildPrompt({
    projectName: project.name,
    taskKey: task.key,
    taskTitle: task.title ?? undefined,
    taskDescription: task.description ?? undefined,
    planContent: latestPlan?.content,
    runHistory: previousRuns
      .filter(r => r.status === 'completed' || r.status === 'interrupted')
      .map(r => ({ agent: r.agent_name, date: r.started_at, completed: r.completed_steps, notes: r.notes })),
  });

  // Deploy skills to project directory
  const skillsFile = deploySkillsToProject(
    agent,
    project.repo_path,
    readCommonSkills(),
    readProjectSkills(projectId),
  );

  // Create run record
  const run = createRun({ task_id: task.id, plan_id: latestPlan?.id, agent_id: agent.id, agent_name: agent.name });
  const sessionId = `plangent-${task.key.replace(/[^a-zA-Z0-9]/g, '-')}-${run.id.slice(0, 8)}`;

  try {
    const result = await launchAgent(agent, project.repo_path, sessionId, project.config.extra_env);

    // Send prompt after agent starts (give it time to initialise)
    setTimeout(() => sendToAgent(sessionId, result.mode, prompt), 3000);

    activeSessions.set(run.id, { sessionId, mode: result.mode, skillsFile });

    res.status(201).json({
      run,
      session_id: sessionId,
      mode: result.mode,
      prompt,
    });
  } catch (err) {
    if (skillsFile) cleanupSkillsFromProject(skillsFile);
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

  // Cleanup skills file
  const session = activeSessions.get(req.params.runId);
  if (session?.skillsFile) cleanupSkillsFromProject(session.skillsFile);
  activeSessions.delete(req.params.runId);

  const r = finishRun(req.params.runId, status, notes);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// GET session status / output
runsRouter.get('/:runId/session', async (req: Request, res: Response) => {
  const session = activeSessions.get(req.params.runId);
  if (!session) {
    return res.json({ running: false });
  }

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

  const session = activeSessions.get(req.params.runId);
  if (!session) return res.status(400).json({ error: 'No active session' });

  await sendToAgent(session.sessionId, session.mode, text);
  res.json({ ok: true });
});

// POST kill agent
runsRouter.post('/:runId/kill', async (req: Request, res: Response) => {
  const session = activeSessions.get(req.params.runId);
  if (session) {
    await killAgent(session.sessionId, session.mode);
    if (session.skillsFile) cleanupSkillsFromProject(session.skillsFile);
    activeSessions.delete(req.params.runId);
  }
  finishRun(req.params.runId, 'interrupted', 'Прерван пользователем');
  res.json({ ok: true });
});
