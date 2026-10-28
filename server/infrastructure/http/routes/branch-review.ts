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
branchReviewRouter.use(localOrigin);
const guard = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
  Promise.resolve().then(() => fn(req, res)).catch(e => {
    if (e instanceof GitOperationError) return res.status(e.status).json({ error: e.message, code: e.code, output: e.output });
    if (e instanceof CodeError) return res.status(e.status).json({ error: e.message });
    if (e instanceof IntegrationError) return res.status(e.status).json({ error: e.message, code: e.code });
    res.status(e instanceof Error && /Ветка не найдена|Invalid commit/.test(e.message) ? 400 : 500).json({ error: e instanceof Error && /Ветка не найдена/.test(e.message) ? e.message : 'Операция ревью не выполнена' });
  });
};
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

branchReviewRouter.get('/branches', guard(async (req, res) => res.json(await review.listBranches(scope(req)))));
branchReviewRouter.post('/fetch', guard(async (req, res) => res.json(await review.fetchBranches(scope(req)))));
branchReviewRouter.post('/open', guard(async (req, res) => res.json(await review.openReview(scope(req), body(req)))));
// For a group the list covers all its projects; opening an MR happens in its own project.
branchReviewRouter.get('/merge-requests', guard(async (req, res) => res.json(await mrReviews().list(scope(req)))));
branchReviewRouter.post('/merge-requests/open', guard(async (req, res) => res.json(await mrReviews().open(scope(req), body(req).iid))));
branchReviewRouter.get('/skills', guard((req, res) => res.json(reviewSkills(scope(req)))));
branchReviewRouter.get('/:id', guard(async (req, res) => res.json(await review.detail(scope(req), req.params.id))));
branchReviewRouter.post('/:id/refresh', guard(async (req, res) => res.json(await mrReviews().refresh(scope(req), req.params.id))));
branchReviewRouter.post('/:id/acknowledge', guard(async (req, res) => res.json(await review.acknowledge(scope(req), req.params.id))));
branchReviewRouter.put('/:id/context', guard((req, res) => res.json(review.setContext(scope(req), req.params.id, body(req)))));
branchReviewRouter.get('/:id/diff', guard(async (req, res) => res.json(await review.diff(scope(req), req.params.id, query(req, 'path')))));
branchReviewRouter.get('/:id/file', guard(async (req, res) => res.json(await review.content(scope(req), req.params.id, query(req, 'path')))));
branchReviewRouter.get('/:id/threads', guard((req, res) => res.json(review.threads(scope(req), req.params.id))));
branchReviewRouter.post('/:id/threads', guard(async (req, res) => res.json(await review.openThread(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/finish', guard(async (req, res) => res.json(await review.finishThreads(scope(req), req.params.id))));

branchReviewRouter.get('/:id/mr', guard(async (req, res) => res.json(await mrReviews().info(scope(req), req.params.id))));
branchReviewRouter.post('/:id/mr/approve', guard(async (req, res) => res.json(await mrReviews().approve(scope(req), req.params.id, body(req).approved))));
branchReviewRouter.post('/:id/mr/threads/:did/reply', guard(async (req, res) => res.json(await mrReviews().reply(scope(req), req.params.id, req.params.did, body(req).body))));
branchReviewRouter.put('/:id/mr/threads/:did/resolved', guard(async (req, res) => res.json(await mrReviews().resolveThread(scope(req), req.params.id, req.params.did, body(req).resolved))));
branchReviewRouter.put('/:id/mr/threads/:did/notes/:nid', guard(async (req, res) => res.json(await mrReviews().editNote(scope(req), req.params.id, req.params.did, Number(req.params.nid), body(req).body))));
branchReviewRouter.delete('/:id/mr/threads/:did/notes/:nid', guard(async (req, res) => res.json(await mrReviews().deleteNote(scope(req), req.params.id, req.params.did, Number(req.params.nid)))));

branchReviewRouter.get('/:id/remarks', guard(async (req, res) => res.json(await remarks().list(scope(req), req.params.id))));
branchReviewRouter.post('/:id/remarks', guard(async (req, res) => res.json(await remarks().add(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/remarks/publish', guard(async (req, res) => res.json(await remarks().publish(scope(req), req.params.id, body(req).ids, body(req).confirmed))));
branchReviewRouter.post('/:id/remarks/mark-sent', guard(async (req, res) => res.json(await remarks().markSent(scope(req), req.params.id, body(req).ids))));
branchReviewRouter.put('/:id/remarks/:rid', guard(async (req, res) => res.json(await remarks().edit(scope(req), req.params.id, req.params.rid, body(req)))));
branchReviewRouter.delete('/:id/remarks/:rid', guard(async (req, res) => res.json(await remarks().remove(scope(req), req.params.id, req.params.rid))));
branchReviewRouter.post('/:id/remarks/:rid/detach', guard(async (req, res) => res.json(await remarks().detach(scope(req), req.params.id, req.params.rid))));
branchReviewRouter.post('/:id/remarks/:rid/recover', guard(async (req, res) => res.json(await remarks().recover(scope(req), req.params.id, req.params.rid, body(req).published))));

branchReviewRouter.post('/:id/analyze', guard(async (req, res) => res.json(await agent.analyze(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/restart', guard(async (req, res) => res.json(await agent.restart(scope(req), req.params.id))));
branchReviewRouter.post('/:id/check-fixes', guard(async (req, res) => res.json(await agent.checkFixes(scope(req), req.params.id))));
branchReviewRouter.get('/:id/questions', guard((req, res) => res.json(questions.list(scope(req), req.params.id))));
branchReviewRouter.post('/:id/questions', guard(async (req, res) => res.json(await questions.add(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/questions/send', guard(async (req, res) => res.json(await questions.send(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/questions/:qid/messages', guard((req, res) => res.json(questions.reply(scope(req), req.params.id, req.params.qid, body(req).text))));
branchReviewRouter.put('/:id/questions/:qid/messages/:mid', guard((req, res) => res.json(questions.edit(scope(req), req.params.id, req.params.qid, req.params.mid, body(req).text))));
branchReviewRouter.delete('/:id/questions/:qid/messages/:mid', guard((req, res) => res.json(questions.removeMessage(scope(req), req.params.id, req.params.qid, req.params.mid))));
branchReviewRouter.post('/:id/questions/:qid/close', guard((req, res) => res.json(questions.close(scope(req), req.params.id, req.params.qid, body(req).closed !== false))));
branchReviewRouter.post('/:id/questions/stop', guard(async (req, res) => res.json(await questions.stop(scope(req), req.params.id))));
