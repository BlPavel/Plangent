import { GitOperationError } from '../../../core/git/repo/operations';
import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { getWorkspace } from '../../../core/workspaces/store';
import { Router } from 'express';
import { finishes, getFinish, activeFinish, taskFinishState } from '../../../core/git/finish';
import { DomainError } from '../../../models/domain-error';
import { gitRoot } from './git';
import { localOrigin } from '../local-origin';
export const finishRouter = Router({ mergeParams: true });
const finishRouterRoutes = typedRoutes(finishRouter, '/api/projects/:projectId/finish');
finishRouter.use(localOrigin);
finishRouter.use((req, res, next) => { try { gitRoot(req); next(); } catch (error) { res.status(error instanceof DomainError ? error.status : 500).json({ error: String(error) }); } });
const owned = (projectId: string, id: string) => {
  const run = getFinish(id);
  if (run.project_id !== projectId) throw new DomainError('Finish not found', 404);
  return run;
};
finishRouterRoutes.json('GET /api/projects/:projectId/finish', async (req, res) => { try { return res.json(activeFinish(req.params.projectId, req.query.workspace as string | undefined)); } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('POST /api/projects/:projectId/finish', async (req, res) => { try { 
  let input = req.body;
  if (req.query.workspace !== undefined) {
    const workspace = getWorkspace(String(req.query.workspace));
    if (input?.task_id && input.task_id !== workspace.task_id) throw new DomainError('Workspace belongs to another task', 409);
    input = { ...input, task_id: workspace.task_id };
  }
  res.status(201).json(await finishes().start(req.params.projectId, input));
 } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('GET /api/projects/:projectId/finish/task/:taskId', async (req, res) => { try { 
  const state = taskFinishState(req.params.taskId);
  if (state && state.project_id !== req.params.projectId) throw new DomainError('Task not found', 404);
  res.json(state);
 } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('GET /api/projects/:projectId/finish/:id', async (req, res) => { try { return res.json(owned(req.params.projectId, req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('GET /api/projects/:projectId/finish/:id/context', async (req, res) => { try {  owned(req.params.projectId, req.params.id); res.json(await finishes().context(req.params.id));  } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('PUT /api/projects/:projectId/finish/:id/commits', async (req, res) => { try { 
  owned(req.params.projectId, req.params.id); res.json(await finishes().setCommits(req.params.id, req.body?.commits, false, req.body?.overrideForbidden === true, req.body?.skipHooks === true));
 } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('PUT /api/projects/:projectId/finish/:id/merge-request', async (req, res) => { try { 
  owned(req.params.projectId, req.params.id); res.json(await finishes().setMergeRequest(req.params.id, req.body?.title, req.body?.description));
 } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('POST /api/projects/:projectId/finish/:id/revise', async (req, res) => { try {  owned(req.params.projectId, req.params.id); res.json(await finishes().revise(req.params.id, req.body?.note ?? ''));  } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('POST /api/projects/:projectId/finish/:id/accept', async (req, res) => { try {  owned(req.params.projectId, req.params.id); res.json(await finishes().accept(req.params.id));  } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('POST /api/projects/:projectId/finish/:id/rollback', async (req, res) => { try {  owned(req.params.projectId, req.params.id); if (req.body?.confirmed !== true) throw new DomainError('Подтвердите откат коммитов'); res.json(await finishes().rollback(req.params.id));  } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('POST /api/projects/:projectId/finish/:id/cancel', async (req, res) => { try {  owned(req.params.projectId, req.params.id); res.json(await finishes().cancel(req.params.id, req.body?.reset === true));  } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.json('POST /api/projects/:projectId/finish/:id/adopt-hook-changes', async (req, res) => { try {  owned(req.params.projectId, req.params.id); res.json(await finishes().adoptHookChanges(req.params.id));  } catch (routeError) { return handleRouteError(routeError, res); } });
finishRouterRoutes.empty('POST /api/projects/:projectId/finish/:id/cancel-operation', async (req, res) => { try {  owned(req.params.projectId, req.params.id); finishes().cancelOperation(req.params.id); res.status(204).end();  } catch (routeError) { return handleRouteError(routeError, res); } });

function handleRouteError(error: unknown, res: ErrorResponse) {
    if (!res.headersSent) res.status(error instanceof DomainError ? error.status : 500).json({
      error: error instanceof DomainError ? (error as Error).message : 'Git operation failed',
      ...(error instanceof GitOperationError ? { output: error.output, code: (error as NodeJS.ErrnoException).code } : {}),
    });
  }
