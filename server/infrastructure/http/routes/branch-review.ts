import { Router, type Request, type Response } from 'express';
import { localOrigin } from '../local-origin';
import { CodeError } from '../../../core/code/files';
import { GitOperationError } from '../../../core/code/git-write';
import * as review from '../../../core/branch-review';
import * as questions from '../../../core/branch-review/questions';

/** Local branch review: everything is plain git on the registered repository, no hosting API involved. */
export const branchReviewRouter = Router({ mergeParams: true });
branchReviewRouter.use(localOrigin);
const guard = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
  Promise.resolve().then(() => fn(req, res)).catch(e => {
    if (e instanceof GitOperationError) return res.status(e.status).json({ error: e.message, code: e.code, output: e.output });
    if (e instanceof CodeError) return res.status(e.status).json({ error: e.message });
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
branchReviewRouter.get('/:id', guard(async (req, res) => res.json(await review.detail(scope(req), req.params.id))));
branchReviewRouter.post('/:id/refresh', guard(async (req, res) => res.json(await review.refreshReview(scope(req), req.params.id))));
branchReviewRouter.post('/:id/acknowledge', guard(async (req, res) => res.json(await review.acknowledge(scope(req), req.params.id))));
branchReviewRouter.get('/:id/diff', guard(async (req, res) => res.json(await review.diff(scope(req), req.params.id, query(req, 'path')))));
branchReviewRouter.get('/:id/file', guard(async (req, res) => res.json(await review.content(scope(req), req.params.id, query(req, 'path')))));
branchReviewRouter.put('/:id/viewed', guard(async (req, res) => res.json(await review.setViewed(scope(req), req.params.id, body(req).path, body(req).viewed === true))));
branchReviewRouter.get('/:id/threads', guard((req, res) => res.json(review.threads(scope(req), req.params.id))));
branchReviewRouter.post('/:id/threads', guard(async (req, res) => res.json(await review.openThread(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/finish', guard(async (req, res) => res.json(await review.finishThreads(scope(req), req.params.id))));

branchReviewRouter.get('/:id/questions', guard((req, res) => res.json(questions.list(scope(req), req.params.id))));
branchReviewRouter.post('/:id/questions', guard(async (req, res) => res.json(await questions.add(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/questions/send', guard(async (req, res) => res.json(await questions.send(scope(req), req.params.id, body(req)))));
branchReviewRouter.post('/:id/questions/:qid/messages', guard((req, res) => res.json(questions.reply(scope(req), req.params.id, req.params.qid, body(req).text))));
branchReviewRouter.put('/:id/questions/:qid/messages/:mid', guard((req, res) => res.json(questions.edit(scope(req), req.params.id, req.params.qid, req.params.mid, body(req).text))));
branchReviewRouter.delete('/:id/questions/:qid/messages/:mid', guard((req, res) => res.json(questions.removeMessage(scope(req), req.params.id, req.params.qid, req.params.mid))));
branchReviewRouter.post('/:id/questions/:qid/close', guard((req, res) => res.json(questions.close(scope(req), req.params.id, req.params.qid, body(req).closed !== false))));
branchReviewRouter.post('/:id/questions/stop', guard(async (req, res) => res.json(await questions.stop(scope(req), req.params.id))));
