import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { getTask } from '../../../core/tasks';
import { rootForWorkspace } from '../../../core/workspaces/roots';
import { Router, type Request, type Response } from 'express';
import { DomainError } from '../../../models/domain-error';
import { reviews, createReviewService } from '../../../core/review/code/reviews';
import { externalThreads } from '../../../core/review/code/external';
import { IntegrationError } from '../../../core/integrations';
import { localOrigin } from '../local-origin';

export function createCodeReviewsRouter(service: () => ReturnType<typeof createReviewService> = reviews) {
  const scoped = (req: Request) => {
    if (req.query.workspace !== undefined) rootForWorkspace(req.params.projectId, req.query.workspace);
    const taskId = req.query.task;
    if (taskId !== undefined && (typeof taskId !== 'string' || getTask(taskId)?.project_id !== req.params.projectId)) throw new DomainError('Task not found', 404);
    return service === reviews ? reviews(req.query.workspace as string | undefined, taskId as string | undefined) : service();
  };
  const router = Router({ mergeParams: true });
const routerRoutes = typedRoutes(router, '/api/projects/:projectId/code-reviews');
  router.use(localOrigin);
  router.use((req, res, next) => {
    try {
      if (req.query.workspace !== undefined) rootForWorkspace(req.params.projectId, req.query.workspace);
      next();
    } catch (error) {
      res.status(error instanceof DomainError ? error.status : 500).json({ error: (error as Error).message });
    }
  });
  
  const query = (req: Request, key: string, fallback = '') => {
    const value = req.query[key] ?? fallback;
    if (typeof value !== 'string') throw new DomainError('Invalid ' + key);
    return value;
  };
  const body = (req: Request): Record<string, any> => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new DomainError('Invalid body');
    return req.body;
  };
  // Colleagues' discussions on the current branch's merge request; replies go to the hosting after confirmation.
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/external', async (req, res) => { try { return res.json(await externalThreads(req.query.workspace as string | undefined).pull(req.params.projectId)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/external/:discussionId/reply', async (req, res) => { try { 
    const { body: text, confirmed } = body(req);
    res.json(await externalThreads(req.query.workspace as string | undefined).reply(req.params.projectId, req.params.discussionId, text, confirmed));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('PUT /api/projects/:projectId/code-reviews/external/:discussionId/resolved', async (req, res) => { try { 
    res.json(await externalThreads(req.query.workspace as string | undefined).resolve(req.params.projectId, req.params.discussionId, body(req).resolved));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('PUT /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId', async (req, res) => { try { 
    res.json(await externalThreads(req.query.workspace as string | undefined).edit(req.params.projectId, req.params.discussionId, Number(req.params.noteId), body(req).body));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('DELETE /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId', async (req, res) => { try { 
    res.json(await externalThreads(req.query.workspace as string | undefined).remove(req.params.projectId, req.params.discussionId, Number(req.params.noteId), req.query.confirmed === 'true'));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/attention', async (req, res) => { try { return res.json(scoped(req).attention(req.params.projectId)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/:reviewId/rounds', async (req, res) => { try { 
    const { session_id, note, item_ids } = body(req);
    if (note !== undefined && typeof note !== 'string') throw new DomainError('Invalid note');
    if (item_ids !== undefined && (!Array.isArray(item_ids) || !item_ids.length || item_ids.some(id => typeof id !== 'string'))) throw new DomainError('Invalid item_ids');
    if (typeof session_id !== 'string' || !session_id.trim()) throw new DomainError('Session required');
    res.status(201).json(await scoped(req).sendRound(req.params.projectId, req.params.reviewId, session_id, note, item_ids));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/:reviewId/stop', async (req, res) => { try { return res.json(await scoped(req).stop(req.params.projectId, req.params.reviewId)); } catch (routeError) { return handleRouteError(routeError, res); } });
  // Threads: the developer's queued replies and verdicts.
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages', async (req, res) => { try { return res.status(201).json(await scoped(req).addMessage(
    req.params.projectId, req.params.reviewId, req.params.itemId, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.empty('DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages/:messageId', async (req, res) => { try { 
    await scoped(req).removeMessage(req.params.projectId, req.params.reviewId, req.params.itemId, req.params.messageId);
    res.status(204).end();
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/close', async (req, res) => { try { return res.json(await scoped(req).closeItem(
    req.params.projectId, req.params.reviewId, req.params.itemId, String(body(req).resolution))); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('PUT /api/projects/:projectId/code-reviews/current/viewed', async (req, res) => { try { 
    const { path, viewed, origin = 'project', origin_id = req.params.projectId } = body(req);
    if (typeof path !== 'string' || typeof viewed !== 'boolean') throw new DomainError('Invalid viewed file');
    res.json(await scoped(req).markViewedCurrent(req.params.projectId, path, viewed, origin, origin_id));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/current/comparison', async (req, res) => { try { return res.json(await scoped(req).remoteComparison(req.params.projectId, query(req, 'ref'))); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/current', async (req, res) => { try { return res.json(await scoped(req).current(req.params.projectId)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews', async (req, res) => { try { return res.json(await scoped(req).history(req.params.projectId)); } catch (routeError) { return handleRouteError(routeError, res); } });
  // No explicit "start review" endpoint: creating the first draft creates the review.
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/items', async (req, res) => { try { 
    const { origin = 'project', origin_id = req.params.projectId, ...item } = body(req);
    res.status(201).json(await scoped(req).addDraft(req.params.projectId, item as Parameters<ReturnType<typeof createReviewService>['addDraft']>[1], origin, origin_id));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/:reviewId', async (req, res) => { try { return res.json(await scoped(req).detail(req.params.projectId, req.params.reviewId)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/:reviewId/file-items', async (req, res) => { try { return res.json(await scoped(req).openFile(
    req.params.projectId, req.params.reviewId, query(req, 'path'), query(req, 'side', 'new') as 'new' | 'old')); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/:reviewId/diff', async (req, res) => { try { return res.json({ diff: await scoped(req).reviewDiff(
    req.params.projectId, req.params.reviewId, query(req, 'path')) }); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('GET /api/projects/:projectId/code-reviews/:reviewId/changes', async (req, res) => { try { 
    const base = query(req, 'base');
    if (base !== 'agent' && base !== 'review') throw new DomainError('Invalid base');
    res.json(await scoped(req).baseChanges(req.params.projectId, req.params.reviewId, base, query(req, 'round') || undefined));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('PATCH /api/projects/:projectId/code-reviews/:reviewId/items/:itemId', async (req, res) => { try { return res.json(await scoped(req).updateDraft(
    req.params.projectId, req.params.reviewId, req.params.itemId, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.empty('DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId', async (req, res) => { try { 
    await scoped(req).removeItem(req.params.projectId, req.params.reviewId, req.params.itemId);
    res.status(204).end();
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/general', async (req, res) => { try { return res.json(await scoped(req).makeGeneral(
    req.params.projectId, req.params.reviewId, req.params.itemId)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('PUT /api/projects/:projectId/code-reviews/:reviewId/viewed', async (req, res) => { try { 
    const data = body(req);
    if (typeof data.path !== 'string' || typeof data.viewed !== 'boolean') throw new DomainError('Invalid viewed file');
    res.json(await scoped(req).markViewed(req.params.projectId, req.params.reviewId, data.path, data.viewed));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.json('POST /api/projects/:projectId/code-reviews/:reviewId/finish', async (req, res) => { try { return res.json(await scoped(req).finish(
    req.params.projectId, req.params.reviewId, body(req).mode)); } catch (routeError) { return handleRouteError(routeError, res); } });
  routerRoutes.empty('DELETE /api/projects/:projectId/code-reviews/:reviewId', async (req, res) => { try { 
    await scoped(req).removeReview(req.params.projectId, req.params.reviewId);
    res.status(204).end();
   } catch (routeError) { return handleRouteError(routeError, res); } });
  return router;
}
export const codeReviewsRouter = createCodeReviewsRouter();

function handleRouteError(error: unknown, res: ErrorResponse) {
      const status = error instanceof DomainError || error instanceof IntegrationError ? error.status : 500;
      res.status(status).json({ error: status === 500 ? 'Review operation failed' : (error as Error).message });
    }
