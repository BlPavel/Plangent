import { listWork, workAttention } from '../../../core/work';
import { closeWork, reopenWork, cancelErrand, addPlan, errandFromWork } from '../../../core/work/actions';
import { WorkspaceRemovalError } from '../../../core/workspaces';
import { Router, type Request } from 'express';
import { createErrand } from '../../../core/work/errands';
import { taskChat } from '../../../core/work/task-chat';
import { launchIndependentReview } from '../../../core/orchestration/task-review';
import { getTask } from '../../../core/tasks';
import { activeWorkspace, rootForTask, assertTaskWorkspaceReady } from '../../../core/workspaces';
import { reviews } from '../../../core/code-reviews/reviews';
import { repositoryInfo, taskWorktreeChanges } from '../../../core/code/git';
import { readCodeFile, CodeError } from '../../../core/code/files';
import { listSessions } from '../../../core/agent-sessions/sessions';
export const workRouter = Router({ mergeParams: true });
workRouter.post('/errands', async (req: Request, res) => {
  try { await createErrand(req.params.projectId, req.body ?? {}, task => res.status(202).json({ task })); }
  catch (error) { if (!res.headersSent) res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

workRouter.post('/tasks/:taskId/chat', async (req: Request, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try { res.json(await taskChat(req.params.taskId, req.body?.agent_id)); }
  catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

workRouter.post('/tasks/:taskId/review', async (req: Request, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try { res.status(201).json(await launchIndependentReview(req.params.taskId, req.body ?? {})); }
  catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});

workRouter.get('/tasks/:taskId/check', async (req: Request, res) => {
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
workRouter.get('/tasks/:taskId/check/file', async (req: Request, res) => {
  if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
  try {
    assertTaskWorkspaceReady(req.params.taskId);
    if (typeof req.query.file !== 'string') throw new Error('File required');
    const file = req.query.file;
    res.json(await readCodeFile(rootForTask(req.params.taskId), file).catch(error => {
      if (error instanceof CodeError && error.status === 404) return { path: file, kind: 'text', content: '', size: 0 };
      throw error;
    }));
  } catch (error) { res.status(400).json({ error: String(error instanceof Error ? error.message : error) }); }
});
workRouter.post('/tasks/:taskId/check/send', async (req: Request, res) => {
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
workAttentionRouter.get('/attention', (_req, res) => res.json(workAttention()));
workRouter.get('/work', (req: Request, res) => res.json(listWork(req.params.projectId)));
for (const action of ['close', 'reopen', 'cancel', 'add-plan', 'errand']) {
  workRouter.post('/tasks/:taskId/' + action, async (req: Request, res) => {
    if (getTask(req.params.taskId)?.project_id !== req.params.projectId) return res.status(404).json({ error: 'Task not found' });
    try {
      const id = req.params.taskId;
      const result = action === 'close' ? await closeWork(id, { discard: req.body?.discard === true })
        : action === 'reopen' ? await reopenWork(id)
        : action === 'cancel' ? await cancelErrand(id, req.body?.mode)
        : action === 'add-plan' ? await addPlan(id)
        : await errandFromWork(id, req.body ?? {});
      res.json(result);
    } catch (error) {
      res.status(error instanceof CodeError ? error.status : 400).json({ error: error instanceof Error ? error.message : String(error),
        ...(error instanceof WorkspaceRemovalError ? { blockers: error.blockers } : {}) });
    }
  });
}
