import { GitOperationError } from '../../../core/code/git-write';
import { CodeError } from '../../../core/code/files';
import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { Router } from 'express';
import { conflictState, resolveConflicts, stopConflicts } from '../../../core/conflicts';
import { gitRoot } from './git';
import { localOrigin } from '../local-origin';

/** Conflicts of a merge/rebase the developer runs themselves; the agent only edits the files. */
export const conflictsRouter = Router({ mergeParams: true });
const conflictsRouterRoutes = typedRoutes(conflictsRouter, '/api/projects/:projectId/conflicts');
conflictsRouter.use(localOrigin);
conflictsRouterRoutes.json('GET /api/projects/:projectId/conflicts', async (req, res) => { try {  gitRoot(req); res.json(await conflictState(req.params.projectId, req.query.workspace as string | undefined));  } catch (routeError) { return handleRouteError(routeError, res); } });
conflictsRouterRoutes.json('POST /api/projects/:projectId/conflicts/resolve', async (req, res) => { try {  gitRoot(req); res.json(await resolveConflicts(req.params.projectId, req.body ?? {}, req.query.workspace as string | undefined));  } catch (routeError) { return handleRouteError(routeError, res); } });
conflictsRouterRoutes.json('POST /api/projects/:projectId/conflicts/stop', async (req, res) => { try {  gitRoot(req); res.json(await stopConflicts(req.params.projectId, req.query.workspace as string | undefined));  } catch (routeError) { return handleRouteError(routeError, res); } });

function handleRouteError(error: unknown, res: ErrorResponse) {
    if (!res.headersSent) res.status(error instanceof CodeError ? error.status : 500).json({
      error: error instanceof CodeError ? (error as Error).message : 'Git operation failed',
      ...(error instanceof GitOperationError ? { output: error.output, code: (error as NodeJS.ErrnoException).code } : {}),
    });
  }
