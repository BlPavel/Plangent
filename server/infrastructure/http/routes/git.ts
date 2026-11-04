import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { rootForViewing } from '../../../core/workspaces/viewing';
﻿import { generateMessage } from '../../../core/code/generate-message';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { inspectCommitMessage } from '../../../core/code/commit-message';
import { effectiveGitSettings, gitAgent } from '../../../core/projects';
import { commit } from '../../../core/code/git-write';
import { getProject } from '../../../core/projects';
import { CodeError } from '../../../core/code/files';
import { branches, trackingInfo, recentCoauthors, originUrl, gitOperation } from '../../../core/code/git';
import { stage, unstage, discard,fetchRepository, pull, pullRebase, push, pushForce, switchBranch, createBranch, GitOperationError, type GitOperationOptions } from '../../../core/code/git-write';
import { assertRepositoryIdle } from '../../../core/code/git-busy';
import { localOrigin } from '../local-origin';
import { broadcast } from '../../../core/shared/events';

export const gitRouter = Router({ mergeParams: true });
const gitRouterRoutes = typedRoutes(gitRouter, '/api/projects/:projectId/git');
gitRouter.use(localOrigin);
const operations = new Map<string, { projectId: string; controller: AbortController }>();

export function gitRoot(req: Request): string {
  const project = getProject(req.params.projectId);
  if (!project || project.kind !== 'project') throw new CodeError('Project not found', 404);
  return rootForViewing(project.id, req.query.workspace);
}
export async function gitRouteOperation(req: Request, res: import('../typed-route').JsonResponse<'POST /api/projects/:projectId/git/commit'>, action: (root: string, options: GitOperationOptions) => Promise<import('@contracts').JsonValue>) {
  const root = gitRoot(req), projectId = req.params.projectId;
  const id = req.body?.operationId ?? randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || operations.has(id)) throw new CodeError('Invalid operation ID');
  const controller = new AbortController(); operations.set(id, { projectId, controller });
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', cancel);
  broadcast({ type: 'git:progress', project_id: projectId, operationId: id, state: 'started' });
  try {
    const output = await action(root, { signal: controller.signal, assertIdle: () => assertRepositoryIdle(projectId, undefined, root),
      onOutput: output => broadcast({ type: 'git:progress', project_id: projectId, operationId: id, output }) });
    res.json({ operationId: id, output });
    broadcast({ type: 'code:changed', projectId });
  } finally {
    operations.delete(id); res.off('close', cancel);
    broadcast({ type: 'git:progress', project_id: projectId, operationId: id, state: 'finished' });
  }
}
gitRouterRoutes.json('GET /api/projects/:projectId/git/repository', async (req, res) => { try { 
  const root = gitRoot(req); let busyReason = '';
  try { assertRepositoryIdle(req.params.projectId, undefined, root); } catch (error) { busyReason = (error as Error).message; }
  const info = await trackingInfo(root);
  res.json(info ? { ...info, busyReason, operation: await gitOperation(root) } : null);
 } catch (routeError) { return handleRouteError(routeError, res); } });
// `agent` — who actually does the git work here, so the screens can name it without repeating the fallback rules.
gitRouterRoutes.json('GET /api/projects/:projectId/git/settings', async (req, res) => { try { 
  gitRoot(req);
  let agent: ReturnType<typeof gitAgent> | null = null;
  try { agent = gitAgent(req.params.projectId); } catch { /* no agent configured: the screens ask to pick one */ }
  res.json({ ...effectiveGitSettings(req.params.projectId).values, agent });
 } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('GET /api/projects/:projectId/git/coauthors', async (req, res) => { try { return res.json(await recentCoauthors(gitRoot(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('GET /api/projects/:projectId/git/branches', async (req, res) => { try { return res.json(await branches(gitRoot(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/branches/refresh', async (req, res) => { try { 
  const root = gitRoot(req);
  if (await originUrl(root)) await fetchRepository(root, { timeoutMs: 30000 });
  res.json(await branches(root));
 } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.empty('POST /api/projects/:projectId/git/cancel', async (req, res) => { try { 
  gitRoot(req);
  const operation = operations.get(req.body.operationId ?? '');
  if (!operation || operation.projectId !== req.params.projectId) throw new CodeError('Operation not found', 404);
  operation.controller.abort(); res.status(204).end();
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
  const settings = effectiveGitSettings(req.params.projectId).values;
  try { res.json(inspectCommitMessage({ ...req.body, includeDescription: req.body?.includeDescription ?? settings.include_description }, settings)); }
  catch (error) { throw new CodeError((error as Error).message); }
 } catch (routeError) { return handleRouteError(routeError, res); } });
gitRouterRoutes.json('POST /api/projects/:projectId/git/commit', async (req, res) => { try { return await gitRouteOperation(req, res, (root, options) =>
  commit(root, req.body, () => effectiveGitSettings(req.params.projectId).values, options, req.body?.overrideForbidden === true)); } catch (routeError) { return handleRouteError(routeError, res); } });

gitRouterRoutes.json('POST /api/projects/:projectId/git/generate-message', async (req, res) => { try { 
  gitRoot(req);
  res.json(await generateMessage(req.params.projectId, { ...req.body, workspace: req.query.workspace as string | undefined }));
 } catch (routeError) { return handleRouteError(routeError, res); } });

function handleRouteError(error: unknown, res: ErrorResponse) {
    if (!res.headersSent) res.status(error instanceof CodeError ? error.status : 500).json({
      error: error instanceof CodeError ? (error as Error).message : 'Git operation failed',
      ...(error instanceof GitOperationError ? { output: error.output, code: (error as NodeJS.ErrnoException).code } : {}),
    });
  }
