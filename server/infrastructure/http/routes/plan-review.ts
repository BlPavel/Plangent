import { Router, type Request, type Response } from 'express';
import { localOrigin } from '../local-origin';
import { CodeError } from '../../../core/code/files';
import { planReviews, isReviewTarget, type ReviewTarget } from '../../../core/plan-review';
import { planReviewSkills } from '../../../core/library/plan-review-skill';
import { materialReviewSkills } from '../../../core/library/section-settings';

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
/** `?target=architecture|qa` selects the reviewed document; without it the paths work for the plan as before. */
const targetOf = (req: Request): ReviewTarget => {
  const target = req.query.target ?? 'plan';
  if (!isReviewTarget(target)) throw new CodeError('Invalid review target');
  return target;
};
planReviewRouter.get('/', guard((req, res) => res.json(planReviews().list(req.params.projectId, req.params.taskId, targetOf(req)))));
planReviewRouter.post('/', guard((req, res) => {
  // Session binding will be supplied by the reviewer launcher, not arbitrary HTTP input.
  res.status(201).json(planReviews().create(req.params.projectId, req.params.taskId, { target: targetOf(req) }));
}));
planReviewRouter.get('/skills', guard((req, res) => {
  const target = targetOf(req);
  res.json(target === 'plan' ? planReviewSkills(req.params.projectId) : materialReviewSkills(target, req.params.projectId));
}));
planReviewRouter.get('/:id', guard((req, res) => res.json(planReviews().detail(req.params.projectId, req.params.taskId, req.params.id))));
planReviewRouter.put('/:id/remarks/:rid/decision', guard((req, res) =>
  res.json(planReviews().decision(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, body(req)))));
// The developer rewrites a card by hand; the reviewer does it through its MCP tool.
planReviewRouter.put('/:id/remarks/:rid/text', guard((req, res) =>
  res.json(planReviews().revise(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, body(req)))));
// Comments under «Обсудить» pile up in their cards; this sends them to the reviewer in one batch.
planReviewRouter.post('/:id/discuss', guard(async (req, res) => {
  const { askReviewer } = await import('../../../core/plan-review/reviewer');
  res.json(await askReviewer(req.params.projectId, req.params.taskId, req.params.id));
}));
planReviewRouter.post('/:id/remarks/:rid/messages', guard((req, res) =>
  res.json(planReviews().addMessage(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, 'developer', body(req).text))));

planReviewRouter.post('/launch', guard(async (req, res) => {
  const { launch } = await import('../../../core/plan-review/reviewer');
  res.status(201).json(await launch(req.params.projectId, req.params.taskId, { ...body(req), target: targetOf(req) }));
}));
planReviewRouter.post('/:id/send', guard(async (req, res) => {
  const { deliver } = await import('../../../core/plan-review/planner-transport');
  res.json(await deliver(req.params.projectId, req.params.taskId, req.params.id, body(req)));
}));
