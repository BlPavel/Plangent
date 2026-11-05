import { gitRoot as resolveGitRoot, repositoryState, gitSettings, refreshBranches, inspectProjectCommitMessage } from '../../../core/git/repo/service';
import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { generateMessage } from '../../../core/git/commits/generate-message';
import { Router, type Request } from 'express';
import { executeGitOperation, cancelGitOperation } from '../../../core/git/repo/operation';
import { effectiveGitSettings } from '../../../core/settings';
import { commit } from '../../../core/git/repo/git-write';
import { DomainError } from '../../../models/domain-error';
import { branches, recentCoauthors } from '../../../core/git/repo';
import { stage, unstage, discard,fetchRepository, pull, pullRebase, push, pushForce, switchBranch, createBranch, GitOperationError, type GitOperationOptions } from '../../../core/git/repo/operations';
import { localOrigin } from '../local-origin';

export const gitRouter = Router({ mergeParams: true });
const gitRouterRoutes = typedRoutes(gitRouter, '/api/projects/:projectId/git');
gitRouter.use(localOrigin);

export function gitRoot(req: Request): string {
  return resolveGitRoot(req.params.projectId, req.query.workspace);
}
export async function gitRouteOperation(req: Request, res: import('../typed-route').JsonResponse<'POST /api/projects/:projectId/git/commit'>, action: (root: string, options: GitOperationOptions) => Promise<import('@contracts').JsonValue>) {
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', cancel);
  try {
    res.json(await executeGitOperation({ root: gitRoot(req), projectId: req.params.projectId,
      operationId: req.body?.operationId, signal: controller.signal }, action));
  } finally { res.off('close', cancel); }
}

gitRouterRoutes.json('GET /api/projects/:projectId/git/repository', async (req, res) => { try { 
  res.json(await repositoryState(req.params.projectId, gitRoot(req)));
 } catch (routeError) { return handleRouteError(routeError, res); } });
// `agent` — who actually does the git work here, so the screens can name it without repeating the fallback rules.
gitRouterRoutes.json('GET /api/projects/:projectId/git/settings', async (req, res) => { try { 
  gitRoot(req);
  res.json(gitSettings(req.params.projectId));
 } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('GET /api/projects/:projectId/git/coauthors', async (req, res) => { try { return res.json(await recentCoauthors(gitRoot(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('GET /api/projects/:projectId/git/branches', async (req, res) => { try { return res.json(await branches(gitRoot(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/branches/refresh', async (req, res) => { try { 
  res.json(await refreshBranches(gitRoot(req)));
 } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.empty('POST /api/projects/:projectId/git/cancel', async (req, res) => { try { 
  gitRoot(req);
  cancelGitOperation(req.params.projectId, req.body.operationId ?? '');
  res.status(204).end();
 } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/stage', async (req, res) => { try { await gitRouteOperation(req, res, (root, options) => stage(root, req.body.paths, options)); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/unstage', async (req, res) => { try { await gitRouteOperation(req, res, (root, options) => unstage(root, req.body.paths, options)); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/discard', async (req, res) => { try { await gitRouteOperation(req, res, (root, options) => discard(root, req.body.paths, options)); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/fetch', async (req, res) => { try { await gitRouteOperation(req, res, fetchRepository); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/pull', async (req, res) => { try { await gitRouteOperation(req, res, pull); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/push', async (req, res) => { try { await gitRouteOperation(req, res, push); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/pull-rebase', async (req, res) => { try { await gitRouteOperation(req, res, pullRebase); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/push-force', async (req, res) => { try { await gitRouteOperation(req, res, pushForce); } catch (error) { handleRouteError(error, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/switch', async (req, res) => { try { return await gitRouteOperation(req, res, (root, options) => switchBranch(root, req.body?.branch, options)); } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/branch', async (req, res) => { try { return await gitRouteOperation(req, res, (root, options) => createBranch(root, req.body?.name ?? '', req.body?.base ?? 'HEAD', options)); } catch (routeError) { return handleRouteError(routeError, res); } });

gitRouterRoutes.json('POST /api/projects/:projectId/git/commit-message', async (req, res) => { try { 
  gitRoot(req);
  res.json(inspectProjectCommitMessage(req.params.projectId, req.body));
 } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/commit', async (req, res) => { try { return await gitRouteOperation(req, res, (root, options) =>
  commit(root, req.body, () => effectiveGitSettings(req.params.projectId).values, options, req.body?.overrideForbidden === true)); } catch (routeError) { return handleRouteError(routeError, res); } });

gitRouterRoutes.json('POST /api/projects/:projectId/git/generate-message', async (req, res) => { try { 
  gitRoot(req);
  res.json(await generateMessage(req.params.projectId, { ...req.body, workspace: req.query.workspace as string | undefined }));
 } catch (routeError) { return handleRouteError(routeError, res); } });

function handleRouteError(error: unknown, res: ErrorResponse) {
    if (!res.headersSent) res.status(error instanceof DomainError ? error.status : 500).json({
      error: error instanceof DomainError ? (error as Error).message : 'Git operation failed',
      ...(error instanceof GitOperationError ? { output: error.output, code: (error as NodeJS.ErrnoException).code } : {}),
    });
  }
