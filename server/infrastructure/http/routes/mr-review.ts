import { Router, type Request, type Response } from 'express';
import { localOrigin } from '../local-origin';
import { IntegrationError } from '../../../core/integrations';
import { mrReviews, createMrService } from '../../../core/mr-review';
export function createMrReviewRouter(service: () => ReturnType<typeof createMrService> = mrReviews) {
  const r = Router({ mergeParams: true });
  r.use(localOrigin);
  const guard = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    Promise.resolve().then(() => fn(req, res)).catch(e => res.status(e instanceof IntegrationError ? e.status : 500).json({ error: e instanceof IntegrationError ? e.message : 'Операция ревью не выполнена', code: e instanceof IntegrationError ? e.code : 'internal' }));
  };
  const body = (req: Request): Record<string, unknown> => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
      throw new IntegrationError('Invalid body');
    return req.body;
  };
  const query = (req: Request, name: string) => {
    const v = req.query[name];
    if (v !== undefined && typeof v !== 'string')
      throw new IntegrationError('Invalid ' + name);
    return v as string | undefined;
  };
  r.get('/', guard(async (req, res) => res.json(await service().list(req.params.projectId, query(req, 'q')))));
  r.post('/open', guard(async (req, res) => res.json(await service().open(req.params.projectId, body(req)))));
  r.get('/:id', guard((req, res) => res.json(service().detail(req.params.projectId, req.params.id))));
  r.post('/:id/refresh', guard(async (req, res) => {
    const v = body(req).version;
    if (v !== undefined && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1))
      throw new IntegrationError('Invalid version');
    res.json(await service().refresh(req.params.projectId, req.params.id, v as number | undefined));
  }));
  r.get('/:id/threads', guard((req,res) => res.json(service().threads(req.params.projectId,req.params.id))));
  r.post('/:id/threads', guard(async (req,res) => res.json(await service().thread(req.params.projectId,req.params.id,body(req)))));
  r.post('/:id/finish', guard(async (req,res) => res.json(await service().finishReview(req.params.projectId,req.params.id))));
  r.get('/:id/file', guard(async (req, res) => res.json(await service().file(req.params.projectId, req.params.id, query(req, 'path') ?? '', query(req, 'head')))));
  r.post('/:id/drafts', guard(async (req, res) => res.status(201).json(await service().addDraft(req.params.projectId, req.params.id, body(req)))));
  r.patch('/:id/drafts/:draft', guard(async (req, res) => res.json(await service().editDraft(req.params.projectId, req.params.id, req.params.draft, body(req).body))));
  r.delete('/:id/drafts/:draft', guard(async (req, res) => res.json(await service().removeDraft(req.params.projectId, req.params.id, req.params.draft))));
  r.post('/:id/drafts/:draft/recover', guard(async (req, res) => {
    const d = body(req);
    res.json(await service().recover(req.params.projectId, req.params.id, req.params.draft, d.published, d.confirmed));
  }));
  r.post('/:id/publish', guard(async (req, res) => {
    const d = body(req);
    res.json(await service().publish(req.params.projectId, req.params.id, d.ids, d.confirmed));
  }));
  r.post('/:id/discussions/:discussion/reply', guard(async (req, res) => res.json(await service().reply(req.params.projectId, req.params.id, req.params.discussion, body(req).body))));
  r.post('/:id/approve', guard(async (req, res) => {
    const v = body(req).approved;
    if (typeof v !== 'boolean')
      throw new IntegrationError('Invalid approve');
    res.json(await service().approve(req.params.projectId, req.params.id, v));
  }));
  r.put('/:id/viewed', guard((req, res) => {
    const d = body(req);
    res.json(service().viewed(req.params.projectId, req.params.id, d.path, d.viewed));
  }));
  return r;
}
export const mrReviewRouter = createMrReviewRouter();
