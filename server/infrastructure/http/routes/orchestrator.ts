import { Router, Request, Response } from 'express';
import { prepareWork, withWorkStart } from '../../../core/work/start';
import { randomUUID } from 'node:crypto';
import { listSessions, updateSession } from '../../../core/agent-sessions/sessions';
import { closeSession } from '../../../core/agent-sessions/acp-host';
import { finishRun, getRun } from '../../../core/runs';
import { getTask, updateTask } from '../../../core/tasks';
import { getProject } from '../../../core/projects';
import { getAgent } from '../../../core/agents';
import { Orchestrator, getOrchestrator } from '../../../core/orchestration/orchestrator';
import { getQueue, saveQueue, replaceStages, repeatReview, isFrozen, blockedQueues, activeQueues, StageInput } from '../../../core/orchestration/queue';
import { deletePlanFile, materializePlanFile } from '../../../core/orchestration/plan-file';
import { materializeTaskAnalysis } from '../../../core/orchestration/analysis';
import { getLatestPlan, parsePlanSteps } from '../../../core/orchestration/plans';
import { broadcast } from '../../../core/shared/events';

export const orchestratorRouter = Router({ mergeParams: true });

// GET /api/queues/blocked — executing queues (of every project) that wait for the developer
export const queuesRouter = Router();
queuesRouter.get('/blocked', (_req: Request, res: Response) => res.json(blockedQueues()));
// GET /api/queues/active — executing queues (of every project); a restart would stop them
queuesRouter.get('/active', (_req: Request, res: Response) => res.json(activeQueues()));

function taskQueue(req: Request, res: Response) {
  const { projectId, taskId } = req.params;
  if (!getProject(projectId) || getTask(taskId)?.project_id !== projectId) { res.status(404).json({ error: 'Task not found' }); return null; }
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
orchestratorRouter.post('/queue/start', async (req: Request, res: Response) => {
  const queue = taskQueue(req, res);
  if (!queue) return;
  if (getTask(req.params.taskId)?.status === 'done') return res.status(409).json({ error: 'Завершённая задача доступна только для чтения' });
  if (isFrozen(queue)) return res.status(409).json({ error: 'Очередь уже выполняется' });
  if (!queue.stages.length) return res.status(400).json({ error: 'Очередь пуста' });
  try {
    await withWorkStart(queue.taskId, async () => {
      const options = req.body ?? {};
      if (options.auto_review !== undefined && typeof options.auto_review !== 'boolean') throw new Error('Invalid auto_review');
      for (const field of ['base_branch', 'branch_name', 'branch', 'place']) if (options[field] !== undefined && typeof options[field] !== 'string') throw new Error('Invalid ' + field);
      await prepareWork(queue.taskId, options);
      if (options.auto_review !== undefined) updateTask(queue.taskId, { auto_review: options.auto_review });
      const task = getTask(queue.taskId)!;
      if (task.auto_review && !queue.stages.some(stage => stage.sessions.some(s => s.kind === 'review' && s.status !== 'complete'))) {
        const agentId = queue.stages.flatMap(stage => stage.sessions).at(-1)!.agentId;
        queue.stages.push({ id: randomUUID(), pauseAfter: false, sessions: [{ id: randomUUID(), kind: 'review', agentId, queueMode: 'execute', permissionPolicy: 'ask', status: 'queued' }] });
      }
      const orch = new Orchestrator(queue);
      try { await orch.start(); } catch (error) { await orch.fail(String(error)); throw error; }
    });
    res.status(202).json(queue);
  } catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
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
orchestratorRouter.post('/queue/sessions/:sessionId/restart', async (req: Request, res: Response) => {
  const queue = taskQueue(req, res);
  if (!queue) return;
  if (getTask(req.params.taskId)?.status === 'done') return res.status(409).json({ error: 'Задача завершена' });
  const orch = getOrchestrator(req.params.taskId);
  try {
    if (orch) { await orch.restartSession(req.params.sessionId); return res.json(orch.queue); }
    if (!repeatReview(queue, req.params.sessionId)) return res.status(409).json({ error: 'Нет завершённого ревью для повторного запуска' });
    return res.json(saveQueue(queue));
  } catch (error) { return res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

// POST /projects/:projectId/tasks/:taskId/done
// Mark task done — delete plan file, keep DB records
orchestratorRouter.post('/done', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const project = getProject(projectId);
  const task = getTask(taskId);
  if (!project || !task || task.project_id !== projectId) return res.status(404).json({ error: 'Not found' });

  await getOrchestrator(taskId)?.stop('Задача завершена');
  const chats = listSessions(projectId).filter(s => s.task_id === taskId && ['planner', 'analyst'].includes(s.role));
  for (const chat of chats) {
    await closeSession(chat.id);
    updateSession(chat.id, { status: 'ready', reason: 'Задача завершена. Верните её в работу, чтобы продолжить.' });
    if (chat.run_id && getRun(chat.run_id)?.status === 'running') finishRun(chat.run_id, 'interrupted', 'Задача завершена');
  }
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
  if (!project || !task || task.project_id !== projectId) return res.status(404).json({ error: 'Not found' });
  if (task.status !== 'done') return res.json(task);

  const plan = getLatestPlan(taskId);
  if (plan?.content.trim()) materializePlanFile(task, plan, project.repo_path);

  const status = plan && parsePlanSteps(plan.content).some(s => s.done) ? 'in_progress' : 'open';
  const updated = updateTask(taskId, { status });
  materializeTaskAnalysis(taskId);
  broadcast({ type: 'task_status', taskId, status });
  res.json(updated);
});
