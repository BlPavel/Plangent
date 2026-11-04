import type { ErrorResponse } from '../typed-route';
﻿import { typedRoutes } from '../typed-route';
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
const orchestratorRouterRoutes = typedRoutes(orchestratorRouter, '/api/projects/:projectId/tasks/:taskId');

// GET /api/queues/blocked — executing queues (of every project) that wait for the developer
export const queuesRouter = Router();
const queuesRouterRoutes = typedRoutes(queuesRouter, '/api/queues');
queuesRouterRoutes.json('GET /api/queues/blocked', (_req, res) => res.json(blockedQueues()));
// GET /api/queues/active — executing queues (of every project); a restart would stop them
queuesRouterRoutes.json('GET /api/queues/active', (_req, res) => res.json(activeQueues()));

function taskQueue(req: Request, res: ErrorResponse) {
  const { projectId, taskId } = req.params;
  if (!getProject(projectId) || getTask(taskId)?.project_id !== projectId) { res.status(404).json({ error: 'Task not found' }); return null; }
  return getOrchestrator(taskId)?.queue ?? getQueue(taskId, projectId);
}



// GET /projects/:projectId/tasks/:taskId/queue
orchestratorRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/queue', (req, res) => {
  const queue = taskQueue(req, res);
  if (queue) res.json(queue);
});

// PUT /projects/:projectId/tasks/:taskId/queue — replace the stages (only while not running)
orchestratorRouterRoutes.json('PUT /api/projects/:projectId/tasks/:taskId/queue', (req, res) => {
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
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/start', async (req, res) => {
  const queue = taskQueue(req, res);
  if (!queue) return;
  if (getTask(req.params.taskId)?.status === 'done') return res.status(409).json({ error: 'Завершённая задача доступна только для чтения' });
  if (isFrozen(queue)) return res.status(409).json({ error: 'Очередь уже выполняется' });
  if (!queue.stages.length) return res.status(400).json({ error: 'Очередь пуста' });
  try {
    await withWorkStart(queue.taskId, async () => {
      const options = req.body ?? {};
      if (options.auto_review !== undefined && typeof options.auto_review !== 'boolean') throw new Error('Invalid auto_review');
      for (const field of (['base_branch', 'branch_name', 'branch', 'place'] as const)) if (options[field] !== undefined && typeof options[field] !== 'string') throw new Error('Invalid ' + field);
      await prepareWork(queue.taskId, { ...options, place: options.place === 'main' ? undefined : options.place });
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
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/clear-history', (req, res) => {
  const queue = taskQueue(req, res);
  if (!queue) return;
  queue.history = [];
  res.json(saveQueue(queue));
});

orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/stop', async (req, res) => { const orch = getOrchestrator(req.params.taskId); if (!orch) return res.status(409).json({ error: 'Очередь не запущена' }); try { await ((orch: Orchestrator) => orch.stop())(orch); res.json(orch.queue); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); } });
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/pause', async (req, res) => { const orch = getOrchestrator(req.params.taskId); if (!orch) return res.status(409).json({ error: 'Очередь не запущена' }); try { await orch.requestPause(req.body?.on !== false); res.json(orch.queue); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); } });
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/resume', async (req, res) => { const orch = getOrchestrator(req.params.taskId); if (!orch) return res.status(409).json({ error: 'Очередь не запущена' }); try { await ((orch: Orchestrator) => orch.resume())(orch); res.json(orch.queue); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); } });
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/complete', async (req, res) => { const orch = getOrchestrator(req.params.taskId); if (!orch) return res.status(409).json({ error: 'Очередь не запущена' }); try { await orch.manualComplete(req.params.sessionId); res.json(orch.queue); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); } });
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/execute', async (req, res) => { const orch = getOrchestrator(req.params.taskId); if (!orch) return res.status(409).json({ error: 'Очередь не запущена' }); try { await orch.executeReadySession(req.params.sessionId); res.json(orch.queue); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); } });
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/skip', async (req, res) => { const orch = getOrchestrator(req.params.taskId); if (!orch) return res.status(409).json({ error: 'Очередь не запущена' }); try { await orch.skipSession(req.params.sessionId); res.json(orch.queue); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); } });
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/restart', async (req, res) => {
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
orchestratorRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/done', async (req, res) => {
  const { projectId, taskId } = req.params;
  const project = getProject(projectId);
  const task = getTask(taskId);
  if (!project || !task || task.project_id !== projectId) return res.status(404).json({ error: 'Not found' });

  await getOrchestrator(taskId)?.stop('Задача завершена');
  const chats = listSessions(projectId).filter(s => s.task_id === taskId && ['planner', 'analyst', 'material-author'].includes(s.role));
  for (const chat of chats) {
    await closeSession(chat.id);
    updateSession(chat.id, { status: 'ready', reason: 'Задача завершена. Верните её в работу, чтобы продолжить.' });
    if (chat.run_id && getRun(chat.run_id)?.status === 'running') finishRun(chat.run_id, 'interrupted', 'Задача завершена');
  }
  deletePlanFile(task, project.repo_path);

  const updated = updateTask(taskId, { status: 'done' });
  broadcast({ type: 'task_status', taskId, status: 'done' });
  if (!updated) return res.status(404).json({ error: 'Task not found' }); res.json(updated);
});

