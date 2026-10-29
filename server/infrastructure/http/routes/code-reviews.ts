import { getTask } from '../../../core/tasks';
import { rootForWorkspace } from '../../../core/workspaces/roots';
import { Router, type Request, type Response } from 'express';
import { CodeError } from '../../../core/code/files';
import { reviews, createReviewService } from '../../../core/code-reviews/reviews';
import { externalThreads } from '../../../core/code-reviews/external';
import { IntegrationError } from '../../../core/integrations';
import { localOrigin } from '../local-origin';

export function createCodeReviewsRouter(service: () => ReturnType<typeof createReviewService> = reviews) {
  const scoped = (req: Request) => {
    if (req.query.workspace !== undefined) rootForWorkspace(req.params.projectId, req.query.workspace);
    const taskId = req.query.task;
    if (taskId !== undefined && (typeof taskId !== 'string' || getTask(taskId)?.project_id !== req.params.projectId)) throw new CodeError('Task not found', 404);
    return service === reviews ? reviews(req.query.workspace as string | undefined, taskId as string | undefined) : service();
  };
  const router = Router({ mergeParams: true });
  router.use(localOrigin);
  router.use((req, res, next) => {
    try {
      if (req.query.workspace !== undefined) rootForWorkspace(req.params.projectId, req.query.workspace);
      next();
    } catch (error) {
      res.status(error instanceof CodeError ? error.status : 500).json({ error: (error as Error).message });
    }
  });
  const guard = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    Promise.resolve().then(() => handler(req, res)).catch(error => {
      const status = error instanceof CodeError || error instanceof IntegrationError ? error.status : 500;
      res.status(status).json({ error: status === 500 ? 'Review operation failed' : error.message });
    });
  };
  const query = (req: Request, key: string, fallback = '') => {
    const value = req.query[key] ?? fallback;
    if (typeof value !== 'string') throw new CodeError('Invalid ' + key);
    return value;
  };
  const body = (req: Request): Record<string, any> => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new CodeError('Invalid body');
    return req.body;
  };
  // Colleagues' discussions on the current branch's merge request; replies go to the hosting after confirmation.
  router.get('/external', guard(async (req, res) => res.json(await externalThreads(req.query.workspace as string | undefined).pull(req.params.projectId))));
  router.post('/external/:discussionId/reply', guard(async (req, res) => {
    const { body: text, confirmed } = body(req);
    res.json(await externalThreads(req.query.workspace as string | undefined).reply(req.params.projectId, req.params.discussionId, text, confirmed));
  }));
  router.put('/external/:discussionId/resolved', guard(async (req, res) => {
    res.json(await externalThreads(req.query.workspace as string | undefined).resolve(req.params.projectId, req.params.discussionId, body(req).resolved));
  }));
  router.put('/external/:discussionId/notes/:noteId', guard(async (req, res) => {
    res.json(await externalThreads(req.query.workspace as string | undefined).edit(req.params.projectId, req.params.discussionId, Number(req.params.noteId), body(req).body));
  }));
  router.delete('/external/:discussionId/notes/:noteId', guard(async (req, res) => {
    res.json(await externalThreads(req.query.workspace as string | undefined).remove(req.params.projectId, req.params.discussionId, Number(req.params.noteId), req.query.confirmed === 'true'));
  }));
  router.get('/attention', guard((req, res) => res.json(scoped(req).attention(req.params.projectId))));
  router.post('/:reviewId/rounds', guard(async (req, res) => {
    const { session_id, note, item_ids } = body(req);
    if (note !== undefined && typeof note !== 'string') throw new CodeError('Invalid note');
    if (item_ids !== undefined && (!Array.isArray(item_ids) || !item_ids.length || item_ids.some(id => typeof id !== 'string'))) throw new CodeError('Invalid item_ids');
    if (typeof session_id !== 'string' || !session_id.trim()) throw new CodeError('Session required');
    res.status(201).json(await scoped(req).sendRound(req.params.projectId, req.params.reviewId, session_id, note, item_ids));
  }));
  router.post('/:reviewId/stop', guard(async (req, res) => res.json(await scoped(req).stop(req.params.projectId, req.params.reviewId))));
  // Threads: the developer's queued replies and verdicts.
  router.post('/:reviewId/items/:itemId/messages', guard(async (req, res) => res.status(201).json(await scoped(req).addMessage(
    req.params.projectId, req.params.reviewId, req.params.itemId, body(req)))));
  router.delete('/:reviewId/items/:itemId/messages/:messageId', guard(async (req, res) => {
    await scoped(req).removeMessage(req.params.projectId, req.params.reviewId, req.params.itemId, req.params.messageId);
    res.sendStatus(204);
  }));
  router.post('/:reviewId/items/:itemId/close', guard(async (req, res) => res.json(await scoped(req).closeItem(
    req.params.projectId, req.params.reviewId, req.params.itemId, String(body(req).resolution)))));
  router.put('/current/viewed', guard(async (req, res) => {
    const { path, viewed, origin = 'project', origin_id = req.params.projectId } = body(req);
    if (typeof path !== 'string' || typeof viewed !== 'boolean') throw new CodeError('Invalid viewed file');
    res.json(await scoped(req).markViewedCurrent(req.params.projectId, path, viewed, origin, origin_id));
  }));
  router.get('/current/comparison', guard(async (req, res) => res.json(await scoped(req).remoteComparison(req.params.projectId, query(req, 'ref')))));
  router.get('/current', guard(async (req, res) => res.json(await scoped(req).current(req.params.projectId))));
  router.get('/', guard(async (req, res) => res.json(await scoped(req).history(req.params.projectId))));
  // No explicit "start review" endpoint: creating the first draft creates the review.
  router.post('/items', guard(async (req, res) => {
    const { origin = 'project', origin_id = req.params.projectId, ...item } = body(req);
    res.status(201).json(await scoped(req).addDraft(req.params.projectId, item as Parameters<ReturnType<typeof createReviewService>['addDraft']>[1], origin, origin_id));
  }));
  router.get('/:reviewId', guard(async (req, res) => res.json(await scoped(req).detail(req.params.projectId, req.params.reviewId))));
  router.get('/:reviewId/file-items', guard(async (req, res) => res.json(await scoped(req).openFile(
    req.params.projectId, req.params.reviewId, query(req, 'path'), query(req, 'side', 'new') as 'new' | 'old'))));
  router.get('/:reviewId/diff', guard(async (req, res) => res.json({ diff: await scoped(req).reviewDiff(
    req.params.projectId, req.params.reviewId, query(req, 'path')) })));
  router.get('/:reviewId/changes', guard(async (req, res) => {
    const base = query(req, 'base');
    if (base !== 'agent' && base !== 'review') throw new CodeError('Invalid base');
    res.json(await scoped(req).baseChanges(req.params.projectId, req.params.reviewId, base, query(req, 'round') || undefined));
  }));
  router.patch('/:reviewId/items/:itemId', guard(async (req, res) => res.json(await scoped(req).updateDraft(
    req.params.projectId, req.params.reviewId, req.params.itemId, body(req)))));
  router.delete('/:reviewId/items/:itemId', guard(async (req, res) => {
    await scoped(req).removeItem(req.params.projectId, req.params.reviewId, req.params.itemId);
    res.sendStatus(204);
  }));
  router.post('/:reviewId/items/:itemId/general', guard(async (req, res) => res.json(await scoped(req).makeGeneral(
    req.params.projectId, req.params.reviewId, req.params.itemId))));
  router.put('/:reviewId/viewed', guard(async (req, res) => {
    const data = body(req);
    if (typeof data.path !== 'string' || typeof data.viewed !== 'boolean') throw new CodeError('Invalid viewed file');
    res.json(await scoped(req).markViewed(req.params.projectId, req.params.reviewId, data.path, data.viewed));
  }));
  router.post('/:reviewId/finish', guard(async (req, res) => res.json(await scoped(req).finish(
    req.params.projectId, req.params.reviewId, body(req).mode))));
  router.delete('/:reviewId', guard(async (req, res) => {
    await scoped(req).removeReview(req.params.projectId, req.params.reviewId);
    res.sendStatus(204);
  }));
  return router;
}
export const codeReviewsRouter = createCodeReviewsRouter();
