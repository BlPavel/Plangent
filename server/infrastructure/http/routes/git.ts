import { generateMessage } from '../../../core/code/generate-message';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { inspectCommitMessage } from '../../../core/code/commit-message';
import { effectiveGitSettings } from '../../../core/projects';
import { commit } from '../../../core/code/git-write';
import { getProject } from '../../../core/projects';
import { CodeError } from '../../../core/code/files';
import { branches, trackingInfo, recentCoauthors } from '../../../core/code/git';
import { stage, unstage, fetchRepository, pull, push, switchBranch, createBranch, GitOperationError, type GitOperationOptions } from '../../../core/code/git-write';
import { assertRepositoryIdle } from '../../../core/code/git-busy';
import { localOrigin } from '../local-origin';
import { broadcast } from '../../../core/shared/events';

export const gitRouter = Router({ mergeParams: true });
gitRouter.use(localOrigin);
const operations = new Map<string, { projectId: string; controller: AbortController }>();
export const gitRouteGuard = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, _next: NextFunction) => {
  Promise.resolve().then(() => handler(req, res)).catch(error => {
    if (!res.headersSent) res.status(error instanceof CodeError ? error.status : 500).json({
      error: error instanceof CodeError ? error.message : 'Git operation failed',
      ...(error instanceof GitOperationError ? { output: error.output, code: error.code } : {}),
    });
  });
};
export function gitRoot(req: Request): string {
  const project = getProject(req.params.projectId);
  if (!project || project.kind !== 'project') throw new CodeError('Project not found', 404);
  return project.repo_path;
}
export async function gitRouteOperation(req: Request, res: Response, action: (root: string, options: GitOperationOptions) => Promise<unknown>) {
  const root = gitRoot(req), projectId = req.params.projectId;
  const id = req.body?.operationId ?? randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || operations.has(id)) throw new CodeError('Invalid operation ID');
  const controller = new AbortController(); operations.set(id, { projectId, controller });
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', cancel);
  broadcast({ type: 'git:progress', project_id: projectId, operationId: id, state: 'started' });
  try {
    const output = await action(root, { signal: controller.signal, assertIdle: () => assertRepositoryIdle(projectId),
      onOutput: output => broadcast({ type: 'git:progress', project_id: projectId, operationId: id, output }) });
    res.json({ operationId: id, output });
    broadcast({ type: 'code:changed', projectId });
  } finally {
    operations.delete(id); res.off('close', cancel);
    broadcast({ type: 'git:progress', project_id: projectId, operationId: id, state: 'finished' });
  }
}
gitRouter.get('/repository', gitRouteGuard(async (req, res) => {
  const root = gitRoot(req); let busyReason = '';
  try { assertRepositoryIdle(req.params.projectId); } catch (error) { busyReason = (error as Error).message; }
  const info = await trackingInfo(root);
  res.json(info ? { ...info, busyReason } : null);
}));
gitRouter.get('/settings', gitRouteGuard((req, res) => { gitRoot(req); res.json(effectiveGitSettings(req.params.projectId).values); }));
gitRouter.get('/coauthors', gitRouteGuard(async (req, res) => res.json(await recentCoauthors(gitRoot(req)))));
gitRouter.get('/branches', gitRouteGuard(async (req, res) => res.json(await branches(gitRoot(req)))));
gitRouter.post('/cancel', gitRouteGuard((req, res) => {
  gitRoot(req);
  const operation = operations.get(req.body?.operationId);
  if (!operation || operation.projectId !== req.params.projectId) throw new CodeError('Operation not found', 404);
  operation.controller.abort(); res.status(204).end();
}));
for (const [endpoint, action] of Object.entries({ stage, unstage })) {
  gitRouter.post('/' + endpoint, gitRouteGuard((req, res) => gitRouteOperation(req, res, (root, options) => action(root, req.body?.paths, options))));
}
for (const [endpoint, action] of Object.entries({ fetch: fetchRepository, pull, push })) {
  gitRouter.post('/' + endpoint, gitRouteGuard((req, res) => gitRouteOperation(req, res, action)));
}
gitRouter.post('/switch', gitRouteGuard((req, res) => gitRouteOperation(req, res, (root, options) => switchBranch(root, req.body?.branch, options))));
gitRouter.post('/branch', gitRouteGuard((req, res) => gitRouteOperation(req, res, (root, options) => createBranch(root, req.body?.name, req.body?.base, options))));

gitRouter.post('/commit-message', gitRouteGuard((req, res) => {
  gitRoot(req);
  const settings = effectiveGitSettings(req.params.projectId).values;
  try { res.json(inspectCommitMessage({ ...req.body, includeDescription: req.body?.includeDescription ?? settings.include_description }, settings)); }
  catch (error) { throw new CodeError((error as Error).message); }
}));
gitRouter.post('/commit', gitRouteGuard((req, res) => gitRouteOperation(req, res, (root, options) =>
  commit(root, req.body, () => effectiveGitSettings(req.params.projectId).values, options, req.body?.overrideForbidden === true))));

gitRouter.post('/generate-message', gitRouteGuard(async (req, res) => res.json(await generateMessage(req.params.projectId, req.body ?? {}))));
