import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { Router, type Request, type Response } from 'express';
import { localOrigin } from '../local-origin';
import { DomainError } from '../../../models/domain-error';
import { planReviews, isReviewTarget, type ReviewTarget } from '../../../core/review/plan';
import { planReviewSkills } from '../../../core/library/plan-review-skill';
import { materialReviewSkills } from '../../../core/library/section-settings';

export const planReviewRouter = Router({ mergeParams: true });
const planReviewRouterRoutes = typedRoutes(planReviewRouter, '/api/projects/:projectId/tasks/:taskId/plan-reviews');
planReviewRouter.use(localOrigin);

const body = (req: Request): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new DomainError('Invalid body');
  return req.body;
};
/** `?target=architecture|qa` selects the reviewed document; without it the paths work for the plan as before. */
const targetOf = (req: Request): ReviewTarget => {
  const target = req.query.target ?? 'plan';
  if (!isReviewTarget(target)) throw new DomainError('Invalid review target');
  return target;
};
planReviewRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/plan-reviews', async (req, res) => { try { return res.json(planReviews().list(req.params.projectId, req.params.taskId, targetOf(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
planReviewRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/plan-reviews', async (req, res) => { try { 
  // Session binding will be supplied by the reviewer launcher, not arbitrary HTTP input.
  res.status(201).json(planReviews().create(req.params.projectId, req.params.taskId, { target: targetOf(req) }));
 } catch (routeError) { return handleRouteError(routeError, res); } });
planReviewRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/plan-reviews/skills', async (req, res) => { try { 
  const target = targetOf(req);
  res.json(target === 'plan' ? planReviewSkills(req.params.projectId) : materialReviewSkills(target, req.params.projectId));
 } catch (routeError) { return handleRouteError(routeError, res); } });
planReviewRouterRoutes.json('GET /api/projects/:projectId/tasks/:taskId/plan-reviews/:id', async (req, res) => { try { return res.json(planReviews().detail(req.params.projectId, req.params.taskId, req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
planReviewRouterRoutes.json('PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/decision', async (req, res) => { try { return res.json(planReviews().decision(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
// The developer rewrites a card by hand; the reviewer does it through its MCP tool.
planReviewRouterRoutes.json('PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/text', async (req, res) => { try { return res.json(planReviews().revise(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
// Comments under «Обсудить» pile up in their cards; this sends them to the reviewer in one batch.
planReviewRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/discuss', async (req, res) => { try { 
  const { askReviewer } = await import('../../../core/review/plan/reviewer');
  res.json(await askReviewer(req.params.projectId, req.params.taskId, req.params.id));
 } catch (routeError) { return handleRouteError(routeError, res); } });
planReviewRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/messages', async (req, res) => { try { return res.json(planReviews().addMessage(req.params.projectId, req.params.taskId, req.params.id, req.params.rid, 'developer', body(req).text)); } catch (routeError) { return handleRouteError(routeError, res); } });

planReviewRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/plan-reviews/launch', async (req, res) => { try { 
  const { launch } = await import('../../../core/review/plan/reviewer');
  res.status(201).json(await launch(req.params.projectId, req.params.taskId, { ...body(req), target: targetOf(req) }));
 } catch (routeError) { return handleRouteError(routeError, res); } });
planReviewRouterRoutes.json('POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/send', async (req, res) => { try { 
  const { deliver } = await import('../../../core/review/plan/planner-transport');
  res.json(await deliver(req.params.projectId, req.params.taskId, req.params.id, body(req)));
 } catch (routeError) { return handleRouteError(routeError, res); } });

function handleRouteError(e: unknown, res: ErrorResponse) {
    res.status(e instanceof DomainError ? e.status : 500).json({ error: e instanceof DomainError ? e.message : 'Plan review operation failed' });
  }
