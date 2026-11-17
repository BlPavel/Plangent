import { listWork, workAttention } from '../../../core/work';
import { changeWorkBranch } from '../../../core/work/branch';
import { closeCheck, closeWork, reopenWork, cancelErrand, addPlan, errandFromWork } from '../../../core/work/actions';
import { WorkspaceRemovalError } from '../../../core/workspaces';
import { Router } from 'express';
import { typedRoutes, type JsonHandler } from '../typed-route';
import type { EndpointKey, Endpoints } from '@contracts';
import { createErrand, retryErrandPreparation } from '../../../core/work/errands';
import { createPlanTask } from '../../../core/work/plan-tasks';
import { taskChat } from '../../../core/work/task-chat';
import { launchIndependentReview } from '../../../core/review/code/task-review';
import { getTask } from '../../../core/tasks';
import { activeWorkspace, rootForTask, assertTaskWorkspaceReady } from '../../../core/workspaces';
import { reviews } from '../../../core/review/code/reviews';
import { repositoryInfo, taskWorktreeChanges } from '../../../core/git/repo';;
import { readCodeFile } from '../../../core/files/files';
import { DomainError } from '../../../models/domain-error';
import { listSessions } from '../../../core/agents';
export const workRouter = Router({ mergeParams: true });
const work = typedRoutes(workRouter, '/api/projects/:projectId');
work.json('POST /api/projects/:projectId/errands', async (req, res) => {
  try { await createErrand(req.params.projectId, req.body ?? {}, task => res.status(202).json({ task })); }
  catch (error) { if (!res.headersSent) res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

work.json('POST /api/projects/:projectId/plan-tasks', async (req, res) => {
  try { await createPlanTask(req.params.projectId, req.body ?? {}, task => res.status(202).json({ task })); }
  catch (error) { if (!res.headersSent) res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

work.json('POST /api/projects/:projectId/tasks/:taskId/retry-preparation', async (req, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try { res.json(await retryErrandPreparation(req.params.taskId)); }
  catch (error) { res.status(error instanceof DomainError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

work.json('POST /api/projects/:projectId/tasks/:taskId/switch-branch', async (req, res) => {
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', cancel);
  try { res.json(await changeWorkBranch(req.params.projectId, req.params.taskId, req.body, controller.signal)); }
  catch (error) { res.status(error instanceof DomainError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error),
    ...('output' in Object(error) ? { output: (error as { output: string }).output } : {}) }); }
  finally { res.off('close', cancel); }
});

work.json('POST /api/projects/:projectId/tasks/:taskId/chat', async (req, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try { res.json(await taskChat(req.params.taskId, req.body?.agent_id, { replace: req.body?.replace === true, model: req.body?.model, reasoningEffort: req.body?.reasoning_effort })); }
  catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

work.json('POST /api/projects/:projectId/tasks/:taskId/review', async (req, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try { res.status(201).json(await launchIndependentReview(req.params.taskId, req.body ?? {})); }
  catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

work.json('GET /api/projects/:projectId/tasks/:taskId/check', async (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try {
    assertTaskWorkspaceReady(task.id);
    const current = await reviews(activeWorkspace(task.id)?.id, task.id).current(task.project_id);
    const repository = await repositoryInfo(rootForTask(task.id));
    const changes = repository && task.base_commit ? await taskWorktreeChanges(rootForTask(task.id), task.base_commit) : [];
    res.json({ ...current, changes, workspace_id: activeWorkspace(task.id)?.id,
      reviewers: listSessions(task.project_id).filter(s => s.task_id === task.id && s.role === 'task-reviewer') });
  } catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});
work.json('GET /api/projects/:projectId/tasks/:taskId/check/file', async (req, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try {
    assertTaskWorkspaceReady(req.params.taskId);
    if (typeof req.query.file !== 'string') throw new Error('File required');
    const file = req.query.file;
    res.json(await readCodeFile(rootForTask(req.params.taskId), file).catch(error => {
      if (error instanceof DomainError && error.status === 404) return { path: file, kind: 'text', content: '', size: 0 };
      throw error;
    }));
  } catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});
work.json('POST /api/projects/:projectId/tasks/:taskId/check/send', async (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try {
    const chat = await taskChat(task.id, req.body?.agent_id);
    const service = reviews(activeWorkspace(task.id)?.id, task.id);
    const current = await service.current(task.project_id);
    if (!current.review) throw new Error('Ревью не найдено');
    const ids = req.body?.item_ids;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !current.items.some(i => i.id === id && i.origin_id === task.id))) throw new Error('Выберите замечания этой задачи');
    await service.sendRound(task.project_id, current.review.id, chat.id, '', ids);
    res.json(chat);
  } catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

export const workAttentionRouter = Router();
typedRoutes(workAttentionRouter, '/api/work').json('GET /api/work/attention', (_req, res) => res.json(workAttention()));
work.json('GET /api/projects/:projectId/work', (req, res) => res.json(listWork(req.params.projectId)));
type ActionKey = Extract<EndpointKey, `POST /api/projects/:projectId/tasks/:taskId/${'close' | 'reopen' | 'cancel' | 'add-plan' | 'errand'}`>;
function actionHandler<K extends ActionKey>(action: (id: string, body: Endpoints[K]['body']) => Promise<Endpoints[K]['response']>): JsonHandler<K> {
  return async (req, res) => {
    if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
    try {
      const id = req.params.taskId;
      const result = await action(id, req.body);
      res.json(result);
    } catch (error) {
      res.status(error instanceof DomainError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error),
        ...(error instanceof WorkspaceRemovalError ? { blockers: error.blockers } : {}) });
    }
  };
}
work.json('GET /api/projects/:projectId/tasks/:taskId/close-check', async (req, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try { res.json(await closeCheck(req.params.taskId)); }
  catch (error) { res.status(error instanceof DomainError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
work.json('POST /api/projects/:projectId/tasks/:taskId/close', actionHandler<'POST /api/projects/:projectId/tasks/:taskId/close'>((id, body) => closeWork(id, { discard: body?.discard === true })));
work.json('POST /api/projects/:projectId/tasks/:taskId/reopen', actionHandler<'POST /api/projects/:projectId/tasks/:taskId/reopen'>(id => reopenWork(id)));
work.json('POST /api/projects/:projectId/tasks/:taskId/cancel', actionHandler<'POST /api/projects/:projectId/tasks/:taskId/cancel'>((id, body) => cancelErrand(id, body?.mode)));
work.json('POST /api/projects/:projectId/tasks/:taskId/add-plan', actionHandler<'POST /api/projects/:projectId/tasks/:taskId/add-plan'>(id => addPlan(id)));
work.json('POST /api/projects/:projectId/tasks/:taskId/errand', actionHandler<'POST /api/projects/:projectId/tasks/:taskId/errand'>((id, body) => errandFromWork(id, body ?? {})));
