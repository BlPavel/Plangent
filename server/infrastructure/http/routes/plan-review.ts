import { Router, type Request, type Response } from 'express';
import { localOrigin } from '../local-origin';
import { CodeError } from '../../../core/code/files';
import { planReviews } from '../../../core/plan-review';
import { planReviewSkills } from '../../../core/library/plan-review-skill';

export const planReviewRouter = Router({ mergeParams: true });
planReviewRouter.use(localOrigin);
const guard = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
  Promise.resolve().then(() => fn(req, res)).catch(e => {
    res.status(e instanceof CodeError ? e.status : 500).json({ error: e instanceof CodeError ? e.message : 'Plan review operation failed' });
  });
};
const body = (req: Request): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new CodeError('Invalid body');
  return req.body;
};
planReviewRouter.get('/', guard((req, res) => res.json(planReviews().list(req.params.projectId, req.params.taskId))));
planReviewRouter.get('/skills', guard((req, res) => {
  planReviews().list(req.params.projectId, req.params.taskId);
  res.json(planReviewSkills(req.params.projectId));
}));
planReviewRouter.post('/', guard((req, res) => {
  // Session and skill binding will be supplied by the reviewer launcher, not arbitrary HTTP input.
  res.status(201).json(planReviews().create(req.params.projectId, req.params.taskId));
}));
planReviewRouter.get('/:id', guard((req, res) => res.json(planReviews().detail(req.params.projectId, req.params.taskId, req.params.id))));
planReviewRouter.put('/:id/remarks/:rid/decision', guard((req, res) =>
  res.json(planReviews().decision(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, body(req)))));
planReviewRouter.post('/:id/remarks/:rid/messages', guard((req, res) =>
  res.json(planReviews().addMessage(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, 'developer', body(req).text))));

planReviewRouter.post('/launch', guard(async (req, res) => {
  const { launch } = await import('../../../core/plan-review/reviewer');
  res.status(201).json(await launch(req.params.projectId, req.params.taskId, body(req)));
}));
planReviewRouter.get('/:id/planners', guard(async (req, res) => {
  planReviews().detail(req.params.projectId, req.params.taskId, req.params.id);
  const { candidates } = await import('../../../core/plan-review/planner-transport');
  res.json(candidates(req.params.projectId, req.params.taskId));
}));
planReviewRouter.post('/:id/send', guard(async (req, res) => {
  const { deliver } = await import('../../../core/plan-review/planner-transport');
  res.json(await deliver(req.params.projectId, req.params.taskId, req.params.id, body(req)));
}));
