import { Router } from 'express';
import { conflictState, resolveConflicts, stopConflicts } from '../../../core/conflicts';
import { gitRoot, gitRouteGuard } from './git';
import { localOrigin } from '../local-origin';

/** Conflicts of a merge/rebase the developer runs themselves; the agent only edits the files. */
export const conflictsRouter = Router({ mergeParams: true });
conflictsRouter.use(localOrigin);
conflictsRouter.get('/', gitRouteGuard(async (req, res) => { gitRoot(req); res.json(await conflictState(req.params.projectId, req.query.workspace as string | undefined)); }));
conflictsRouter.post('/resolve', gitRouteGuard(async (req, res) => { gitRoot(req); res.json(await resolveConflicts(req.params.projectId, req.body ?? {}, req.query.workspace as string | undefined)); }));
conflictsRouter.post('/stop', gitRouteGuard(async (req, res) => { gitRoot(req); res.json(await stopConflicts(req.params.projectId, req.query.workspace as string | undefined)); }));
