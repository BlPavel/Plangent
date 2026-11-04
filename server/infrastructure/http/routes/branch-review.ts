import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { Router, type Request, type Response } from 'express';
import { localOrigin } from '../local-origin';
import { CodeError } from '../../../core/code/files';
import { GitOperationError } from '../../../core/code/git-write';
import { IntegrationError } from '../../../core/integrations';
import { reviewSkills } from '../../../core/library/review-skill';
import * as review from '../../../core/branch-review';
import * as questions from '../../../core/branch-review/questions';
import * as agent from '../../../core/branch-review/agent';
import { mrReviews } from '../../../core/branch-review/mr';
import { remarks } from '../../../core/branch-review/remarks';

/** Branch review: the code is plain git on the registered repository; a review opened from an MR also talks to GitLab. */
export const branchReviewRouter = Router({ mergeParams: true });
const branchReviewRouterRoutes = typedRoutes(branchReviewRouter, '/api/projects/:projectId/branch-review');
branchReviewRouter.use(localOrigin);

const body = (req: Request): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new CodeError('Invalid body');
  return req.body;
};
const query = (req: Request, name: string) => {
  const v = req.query[name];
  if (v !== undefined && typeof v !== 'string') throw new CodeError('Invalid ' + name);
  return v;
};
const scope = (req: Request) => req.params.projectId;

branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/branches', async (req, res) => { try { return res.json(await review.listBranches(scope(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/fetch', async (req, res) => { try { return res.json(await review.fetchBranches(scope(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/open', async (req, res) => { try { return res.json(await review.openReview(scope(req), body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
// For a group the list covers all its projects; opening an MR happens in its own project.
branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/merge-requests', async (req, res) => { try { return res.json(await mrReviews().list(scope(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/merge-requests/open', async (req, res) => { try { return res.json(await mrReviews().open(scope(req), body(req).iid)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/skills', async (req, res) => { try { return res.json(reviewSkills(scope(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/:id', async (req, res) => { try { return res.json(await review.detail(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/refresh', async (req, res) => { try { return res.json(await mrReviews().refresh(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/acknowledge', async (req, res) => { try { return res.json(await review.acknowledge(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('PUT /api/projects/:projectId/branch-review/:id/context', async (req, res) => { try { return res.json(await review.setContext(scope(req), req.params.id, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/:id/diff', async (req, res) => { try { return res.json(await review.diff(scope(req), req.params.id, query(req, 'path'))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/:id/file', async (req, res) => { try { return res.json(await review.content(scope(req), req.params.id, query(req, 'path'))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/:id/threads', async (req, res) => { try { return res.json(review.threads(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/threads', async (req, res) => { try { return res.json(await review.openThread(scope(req), req.params.id, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/finish', async (req, res) => { try { return res.json(await review.finishThreads(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });

branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/:id/mr', async (req, res) => { try { return res.json(await mrReviews().info(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/mr/approve', async (req, res) => { try { return res.json(await mrReviews().approve(scope(req), req.params.id, body(req).approved)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/mr/threads/:did/reply', async (req, res) => { try { return res.json(await mrReviews().reply(scope(req), req.params.id, req.params.did, body(req).body)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/resolved', async (req, res) => { try { return res.json(await mrReviews().resolveThread(scope(req), req.params.id, req.params.did, body(req).resolved)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid', async (req, res) => { try { return res.json(await mrReviews().editNote(scope(req), req.params.id, req.params.did, Number(req.params.nid), body(req).body)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('DELETE /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid', async (req, res) => { try { return res.json(await mrReviews().deleteNote(scope(req), req.params.id, req.params.did, Number(req.params.nid))); } catch (routeError) { return handleRouteError(routeError, res); } });

branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/:id/remarks', async (req, res) => { try { return res.json(await remarks().list(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/remarks', async (req, res) => { try { return res.json(await remarks().add(scope(req), req.params.id, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/remarks/publish', async (req, res) => { try { return res.json(await remarks().publish(scope(req), req.params.id, body(req).ids, body(req).confirmed)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/remarks/mark-sent', async (req, res) => { try { return res.json(await remarks().markSent(scope(req), req.params.id, body(req).ids)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('PUT /api/projects/:projectId/branch-review/:id/remarks/:rid', async (req, res) => { try { return res.json(await remarks().edit(scope(req), req.params.id, req.params.rid, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('DELETE /api/projects/:projectId/branch-review/:id/remarks/:rid', async (req, res) => { try { return res.json(await remarks().remove(scope(req), req.params.id, req.params.rid)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/remarks/:rid/detach', async (req, res) => { try { return res.json(await remarks().detach(scope(req), req.params.id, req.params.rid)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/remarks/:rid/recover', async (req, res) => { try { return res.json(await remarks().recover(scope(req), req.params.id, req.params.rid, body(req).published)); } catch (routeError) { return handleRouteError(routeError, res); } });

branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/analyze', async (req, res) => { try { return res.json(await agent.analyze(scope(req), req.params.id, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/restart', async (req, res) => { try { return res.json(await agent.restart(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/check-fixes', async (req, res) => { try { return res.json(await agent.checkFixes(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('GET /api/projects/:projectId/branch-review/:id/questions', async (req, res) => { try { return res.json(questions.list(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/questions', async (req, res) => { try { return res.json(await questions.add(scope(req), req.params.id, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/questions/send', async (req, res) => { try { return res.json(await questions.send(scope(req), req.params.id, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/questions/:qid/messages', async (req, res) => { try { return res.json(questions.reply(scope(req), req.params.id, req.params.qid, body(req).text)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('PUT /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid', async (req, res) => { try { return res.json(questions.edit(scope(req), req.params.id, req.params.qid, req.params.mid, body(req).text)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('DELETE /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid', async (req, res) => { try { return res.json(questions.removeMessage(scope(req), req.params.id, req.params.qid, req.params.mid)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/questions/:qid/close', async (req, res) => { try { return res.json(questions.close(scope(req), req.params.id, req.params.qid, body(req).closed !== false)); } catch (routeError) { return handleRouteError(routeError, res); } });
branchReviewRouterRoutes.json('POST /api/projects/:projectId/branch-review/:id/questions/stop', async (req, res) => { try { return res.json(await questions.stop(scope(req), req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });

function handleRouteError(e: unknown, res: ErrorResponse) {
    if (e instanceof GitOperationError) return res.status(e.status).json({ error: e.message, code: e.code, output: e.output });
    if (e instanceof CodeError) return res.status(e.status).json({ error: e.message });
    if (e instanceof IntegrationError) return res.status(e.status).json({ error: e.message, code: e.code });
    res.status(e instanceof Error && /Ветка не найдена|Invalid commit/.test(e.message) ? 400 : 500).json({ error: e instanceof Error && /Ветка не найдена/.test(e.message) ? e.message : 'Операция ревью не выполнена' });
  }
