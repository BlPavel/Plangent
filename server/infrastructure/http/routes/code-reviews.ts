import { Router, type Request, type Response } from 'express';
import { CodeError } from '../../../core/code/files';
import { reviews, createReviewService } from '../../../core/code-reviews/reviews';
import { localOrigin } from '../local-origin';

export function createCodeReviewsRouter(service: () => ReturnType<typeof createReviewService> = reviews) {
  const router = Router({ mergeParams: true });
  router.use(localOrigin);
  const guard = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    Promise.resolve().then(() => handler(req, res)).catch(error => {
      const status = error instanceof CodeError ? error.status : 500;
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
  router.get('/attention', guard((req, res) => res.json(service().attention(req.params.projectId))));
  router.post('/:reviewId/rounds', guard(async (req, res) => {
    const { session_id, note, item_ids } = body(req);
    if (note !== undefined && typeof note !== 'string') throw new CodeError('Invalid note');
    if (item_ids !== undefined && (!Array.isArray(item_ids) || !item_ids.length || item_ids.some(id => typeof id !== 'string'))) throw new CodeError('Invalid item_ids');
    if (typeof session_id !== 'string' || !session_id.trim()) throw new CodeError('Session required');
    res.status(201).json(await service().sendRound(req.params.projectId, req.params.reviewId, session_id, note, item_ids));
  }));
  router.post('/:reviewId/items/:itemId/decision', guard(async (req, res) => res.json(await service().decideItem(
    req.params.projectId, req.params.reviewId, req.params.itemId, body(req).decision))));
  router.put('/current/viewed', guard(async (req, res) => {
    const { path, viewed, origin = 'project', origin_id = req.params.projectId } = body(req);
    if (typeof path !== 'string' || typeof viewed !== 'boolean') throw new CodeError('Invalid viewed file');
    res.json(await service().markViewedCurrent(req.params.projectId, path, viewed, origin, origin_id));
  }));
  router.get('/current', guard(async (req, res) => res.json(await service().current(req.params.projectId))));
  router.get('/', guard(async (req, res) => res.json(await service().history(req.params.projectId))));
  // No explicit "start review" endpoint: creating the first draft creates the review.
  router.post('/items', guard(async (req, res) => {
    const { origin = 'project', origin_id = req.params.projectId, ...item } = body(req);
    res.status(201).json(await service().addDraft(req.params.projectId, item as Parameters<ReturnType<typeof createReviewService>['addDraft']>[1], origin, origin_id));
  }));
  router.get('/:reviewId', guard(async (req, res) => res.json(await service().detail(req.params.projectId, req.params.reviewId))));
  router.get('/:reviewId/file-items', guard(async (req, res) => res.json(await service().openFile(
    req.params.projectId, req.params.reviewId, query(req, 'path'), query(req, 'side', 'new') as 'new' | 'old'))));
  router.get('/:reviewId/diff', guard(async (req, res) => res.json({ diff: await service().reviewDiff(
    req.params.projectId, req.params.reviewId, query(req, 'path')) })));
  router.get('/:reviewId/changes', guard(async (req, res) => {
    const base = query(req, 'base');
    if (base !== 'agent' && base !== 'review') throw new CodeError('Invalid base');
    res.json(await service().baseChanges(req.params.projectId, req.params.reviewId, base, query(req, 'round') || undefined));
  }));
  router.patch('/:reviewId/items/:itemId', guard(async (req, res) => res.json(await service().updateDraft(
    req.params.projectId, req.params.reviewId, req.params.itemId, body(req)))));
  router.delete('/:reviewId/items/:itemId', guard(async (req, res) => {
    await service().removeItem(req.params.projectId, req.params.reviewId, req.params.itemId);
    res.sendStatus(204);
  }));
  router.post('/:reviewId/items/:itemId/general', guard(async (req, res) => res.json(await service().makeGeneral(
    req.params.projectId, req.params.reviewId, req.params.itemId))));
  router.put('/:reviewId/viewed', guard(async (req, res) => {
    const data = body(req);
    if (typeof data.path !== 'string' || typeof data.viewed !== 'boolean') throw new CodeError('Invalid viewed file');
    res.json(await service().markViewed(req.params.projectId, req.params.reviewId, data.path, data.viewed));
  }));
  router.post('/:reviewId/finish', guard(async (req, res) => res.json(await service().finish(
    req.params.projectId, req.params.reviewId, body(req).mode))));
  router.delete('/:reviewId', guard(async (req, res) => {
    await service().removeReview(req.params.projectId, req.params.reviewId);
    res.sendStatus(204);
  }));
  return router;
}
export const codeReviewsRouter = createCodeReviewsRouter();
