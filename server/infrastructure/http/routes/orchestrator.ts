import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getTask, updateTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
import { getAgent } from '../../../core/agents';
import { OrchestratorQueueSession } from '../../../models';
import { QueueSessionInput, Orchestrator, getOrchestrator, removeOrchestrator } from '../../../core/orchestration/orchestrator';
import { deletePlanFile } from '../../../core/orchestration/plan-file';
import { broadcast } from '../../../core/shared/events';

export const orchestratorRouter = Router({ mergeParams: true });

// POST /projects/:projectId/tasks/:taskId/execute
// Start a queue of sessions
orchestratorRouter.post('/execute', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const { sessions: sessionInputs } = req.body as { sessions: QueueSessionInput[] };

  if (!Array.isArray(sessionInputs) || sessionInputs.length === 0) {
    return res.status(400).json({ error: 'sessions array required' });
  }

  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const task = getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Validate agents
  for (const s of sessionInputs) {
    if (!getAgent(s.agentId)) {
      return res.status(400).json({ error: `Agent not found: ${s.agentId}` });
    }
  }

  // Stop any existing orchestrator for this task
  const existing = getOrchestrator(taskId);
  if (existing) {
    if (existing.state.status !== 'finished' && existing.state.status !== 'failed') {
      existing.fail('Replaced by new execute call');
    }
    removeOrchestrator(taskId);
  }

  // Build session objects
	  const sessions: OrchestratorQueueSession[] = sessionInputs.map(s => ({
	    id: uuidv4(),
	    points: s.points,
	    agentId: s.agentId,
	    parallelGroup: s.parallelGroup,
	    queueMode: s.queueMode === 'review_first' ? 'review_first' : 'execute',
	    pauseAfter: s.pauseAfter ?? false,
	    model: s.model,
	    reasoningEffort: s.reasoningEffort,
	    status: 'queued' as const,
	  }));

  const orch = new Orchestrator(taskId, projectId, sessions);

  res.status(202).json({
    orchestratorId: orch.state.id,
    sessions: sessions.map(s => ({ ...s })),
  });

  // Start async (don't block response)
  orch.start().catch(e => {
    console.error('[orchestrator] start error:', e);
    orch.fail(String(e));
  });
});

// POST /projects/:projectId/tasks/:taskId/done
// Mark task done — delete plan file, keep DB records
orchestratorRouter.post('/done', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const project = getProject(projectId);
  const task = getTask(taskId);
  if (!project || !task) return res.status(404).json({ error: 'Not found' });

  // Stop orchestrator if running
  const orch = getOrchestrator(taskId);
  if (orch) {
    orch.fail('Task marked done');
    removeOrchestrator(taskId);
  }

  // Delete plan file
  deletePlanFile(task, project.repo_path);

  // Update task status
  const updated = updateTask(taskId, { status: 'done' });
  broadcast({ type: 'task_status', taskId, status: 'done' });
  res.json(updated);
});

// GET /projects/:projectId/tasks/:taskId/orchestrator
// Current orchestrator state for UI rehydration
orchestratorRouter.get('/orchestrator', (req: Request, res: Response) => {
  const { taskId } = req.params;
  const orch = getOrchestrator(taskId);
  if (!orch) return res.json({ active: false });
  res.json({ active: true, state: orch.getState() });
});

// POST /projects/:projectId/tasks/:taskId/sessions/:sessionId/advance
// Manually mark a session done (waiting OR stuck-running) and advance the queue.
orchestratorRouter.post('/sessions/:sessionId/advance', async (req: Request, res: Response) => {
  const { taskId, sessionId } = req.params;
  const orch = getOrchestrator(taskId);
  if (!orch) return res.status(404).json({ error: 'No active orchestrator' });
  await orch.manualComplete(sessionId);
  res.json({ ok: true });
});

// POST /projects/:projectId/tasks/:taskId/sessions/:sessionId/execute
// Continue a completed preflight session into execution.
orchestratorRouter.post('/sessions/:sessionId/execute', async (req: Request, res: Response) => {
  const { taskId, sessionId } = req.params;
  const orch = getOrchestrator(taskId);
  if (!orch) return res.status(404).json({ error: 'No active orchestrator' });
  await orch.executeReadySession(sessionId);
  res.json({ ok: true });
});

// POST /projects/:projectId/tasks/:taskId/sessions/:sessionId/ready
// Manually mark a preflight session ready when the agent is waiting for input.
orchestratorRouter.post('/sessions/:sessionId/ready', async (req: Request, res: Response) => {
  const { taskId, sessionId } = req.params;
  const orch = getOrchestrator(taskId);
  if (!orch) return res.status(404).json({ error: 'No active orchestrator' });
  await orch.markReadyForExecution(sessionId);
  res.json({ ok: true });
});

// POST /projects/:projectId/tasks/:taskId/sessions/:sessionId/cancel
// Stop a session (queued/running/waiting) and free the queue to advance.
orchestratorRouter.post('/sessions/:sessionId/cancel', async (req: Request, res: Response) => {
  const { taskId, sessionId } = req.params;
  const orch = getOrchestrator(taskId);
  if (!orch) return res.status(404).json({ error: 'No active orchestrator' });
  await orch.cancelSession(sessionId);
  res.json({ ok: true });
});

// POST /projects/:projectId/tasks/:taskId/orchestrator/resume
// Resume the queue after a pauseAfter review checkpoint.
orchestratorRouter.post('/orchestrator/resume', async (req: Request, res: Response) => {
  const { taskId } = req.params;
  const orch = getOrchestrator(taskId);
  if (!orch) return res.status(404).json({ error: 'No active orchestrator' });
  await orch.resume();
  res.json({ ok: true });
});
