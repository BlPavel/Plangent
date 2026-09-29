import { Router, Request, Response } from 'express';
import { getTask, updateTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
import { getAgent } from '../../../core/agents';
import { Orchestrator, getOrchestrator } from '../../../core/orchestration/orchestrator';
import { getQueue, saveQueue, replaceStages, isFrozen, blockedQueues, StageInput } from '../../../core/orchestration/queue';
import { deletePlanFile, materializePlanFile } from '../../../core/orchestration/plan-file';
import { getLatestPlan, parsePlanSteps } from '../../../core/orchestration/plans';
import { broadcast } from '../../../core/shared/events';

export const orchestratorRouter = Router({ mergeParams: true });

// GET /api/queues/blocked — executing queues (of every project) that wait for the developer
export const queuesRouter = Router();
queuesRouter.get('/blocked', (_req: Request, res: Response) => res.json(blockedQueues()));

function taskQueue(req: Request, res: Response) {
  const { projectId, taskId } = req.params;
  if (!getProject(projectId) || !getTask(taskId)) { res.status(404).json({ error: 'Task not found' }); return null; }
  return getOrchestrator(taskId)?.queue ?? getQueue(taskId, projectId);
}

function withOrchestrator(action: (orch: Orchestrator, req: Request) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    const orch = getOrchestrator(req.params.taskId);
    if (!orch) return res.status(409).json({ error: 'Очередь не запущена' });
    try { await action(orch, req); res.json(orch.queue); }
    catch (e) { res.status(400).json({ error: String(e instanceof Error ? e.message : e) }); }
  };
}

// GET /projects/:projectId/tasks/:taskId/queue
orchestratorRouter.get('/queue', (req: Request, res: Response) => {
  const queue = taskQueue(req, res);
  if (queue) res.json(queue);
});

// PUT /projects/:projectId/tasks/:taskId/queue — replace the stages (only while not running)
orchestratorRouter.put('/queue', (req: Request, res: Response) => {
  const queue = taskQueue(req, res);
  if (!queue) return;
  if (isFrozen(queue)) return res.status(409).json({ error: 'Очередь выполняется — остановите её, чтобы изменить' });
  const { stages } = req.body as { stages: StageInput[] };
  if (!Array.isArray(stages)) return res.status(400).json({ error: 'stages array required' });
  for (const s of stages.flatMap(st => st.sessions ?? [])) {
    if (!getAgent(s.agentId)) return res.status(400).json({ error: `Agent not found: ${s.agentId}` });
  }
  res.json(saveQueue(replaceStages(queue, stages)));
});

// POST /projects/:projectId/tasks/:taskId/queue/start — (re)launch from the first unfinished stage
orchestratorRouter.post('/queue/start', (req: Request, res: Response) => {
  const queue = taskQueue(req, res);
  if (!queue) return;
  if (isFrozen(queue)) return res.status(409).json({ error: 'Очередь уже выполняется' });
  if (!queue.stages.length) return res.status(400).json({ error: 'Очередь пуста' });
  const orch = new Orchestrator(queue);
  orch.start().catch(e => {
    console.error('[orchestrator] start error:', e);
    orch.fail(String(e));
  });
  res.status(202).json(queue);
});

// POST /projects/:projectId/tasks/:taskId/queue/clear-history — forget earlier runs
orchestratorRouter.post('/queue/clear-history', (req: Request, res: Response) => {
  const queue = taskQueue(req, res);
  if (!queue) return;
  queue.history = [];
  res.json(saveQueue(queue));
});

orchestratorRouter.post('/queue/stop',withOrchestrator(orch => orch.stop()));
orchestratorRouter.post('/queue/pause', withOrchestrator((orch, req) => orch.requestPause(req.body?.on !== false)));
orchestratorRouter.post('/queue/resume', withOrchestrator(orch => orch.resume()));

// Per-session actions of a running queue.
// complete: accept as done although the agent did not report it; execute: preflight → execution;
// skip: stop this session and go on; restart: start it again with a fresh agent.
orchestratorRouter.post('/queue/sessions/:sessionId/complete', withOrchestrator((orch, req) => orch.manualComplete(req.params.sessionId)));
orchestratorRouter.post('/queue/sessions/:sessionId/execute', withOrchestrator((orch, req) => orch.executeReadySession(req.params.sessionId)));
orchestratorRouter.post('/queue/sessions/:sessionId/skip', withOrchestrator((orch, req) => orch.skipSession(req.params.sessionId)));
orchestratorRouter.post('/queue/sessions/:sessionId/restart', withOrchestrator((orch, req) => orch.restartSession(req.params.sessionId)));

// POST /projects/:projectId/tasks/:taskId/done
// Mark task done — delete plan file, keep DB records
orchestratorRouter.post('/done', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const project = getProject(projectId);
  const task = getTask(taskId);
  if (!project || !task) return res.status(404).json({ error: 'Not found' });

  await getOrchestrator(taskId)?.stop('Задача завершена');
  deletePlanFile(task, project.repo_path);

  const updated = updateTask(taskId, { status: 'done' });
  broadcast({ type: 'task_status', taskId, status: 'done' });
  res.json(updated);
});

// POST /projects/:projectId/tasks/:taskId/reopen
// Back to work after /done: the plan (with its checked steps) is still in the DB, so put its file back.
orchestratorRouter.post('/reopen', (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const project = getProject(projectId);
  const task = getTask(taskId);
  if (!project || !task) return res.status(404).json({ error: 'Not found' });
  if (task.status !== 'done') return res.json(task);

  const plan = getLatestPlan(taskId);
  if (plan?.content.trim()) materializePlanFile(task, plan, project.repo_path);

  const status = plan && parsePlanSteps(plan.content).some(s => s.done) ? 'in_progress' : 'open';
  const updated = updateTask(taskId, { status });
  broadcast({ type: 'task_status', taskId, status });
  res.json(updated);
});
