import { Router } from 'express';
import { finishes, getFinish, activeFinish, taskFinishState } from '../../../core/finish';
import { CodeError } from '../../../core/code/files';
import { gitRoot, gitRouteGuard } from './git';
import { localOrigin } from '../local-origin';
export const finishRouter = Router({ mergeParams: true });
finishRouter.use(localOrigin);
finishRouter.use((req, res, next) => { try { gitRoot(req); next(); } catch (error) { res.status(error instanceof CodeError ? error.status : 500).json({ error: String(error) }); } });
const owned = (projectId: string, id: string) => {
  const run = getFinish(id);
  if (run.project_id !== projectId) throw new CodeError('Finish not found', 404);
  return run;
};
finishRouter.get('/', gitRouteGuard((req, res) => res.json(activeFinish(req.params.projectId))));
finishRouter.post('/', gitRouteGuard(async (req, res) => res.status(201).json(await finishes().start(req.params.projectId, req.body))));
finishRouter.get('/task/:taskId', gitRouteGuard((req, res) => {
  const state = taskFinishState(req.params.taskId);
  if (state && state.project_id !== req.params.projectId) throw new CodeError('Task not found', 404);
  res.json(state);
}));
finishRouter.get('/:id', gitRouteGuard((req, res) => res.json(owned(req.params.projectId, req.params.id))));
finishRouter.get('/:id/context', gitRouteGuard(async (req, res) => { owned(req.params.projectId, req.params.id); res.json(await finishes().context(req.params.id)); }));
finishRouter.put('/:id/commits', gitRouteGuard(async (req, res) => {
  owned(req.params.projectId, req.params.id); res.json(await finishes().setCommits(req.params.id, req.body?.commits, false, req.body?.overrideForbidden === true));
}));
finishRouter.post('/:id/revise', gitRouteGuard(async (req, res) => { owned(req.params.projectId, req.params.id); res.json(await finishes().revise(req.params.id, req.body?.note)); }));
finishRouter.post('/:id/accept', gitRouteGuard(async (req, res) => { owned(req.params.projectId, req.params.id); res.json(await finishes().accept(req.params.id)); }));
finishRouter.post('/:id/rollback', gitRouteGuard(async (req, res) => { owned(req.params.projectId, req.params.id); if (req.body?.confirmed !== true) throw new CodeError('Подтвердите откат коммитов'); res.json(await finishes().rollback(req.params.id)); }));
finishRouter.post('/:id/cancel-operation', gitRouteGuard((req, res) => { owned(req.params.projectId, req.params.id); finishes().cancelOperation(req.params.id); res.status(204).end(); }));
