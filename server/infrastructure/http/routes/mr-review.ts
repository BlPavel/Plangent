import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { Router, type Request, type Response } from 'express';
import { localOrigin } from '../local-origin';
import { IntegrationError } from '../../../core/integrations';
import { mrReviews, createMrService } from '../../../core/mr-review';
export function createMrReviewRouter(service: () => ReturnType<typeof createMrService> = mrReviews) {
  const r = Router({ mergeParams: true });
const rRoutes = typedRoutes(r, '/api/projects/:projectId/mr-review');
  r.use(localOrigin);
  
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
  rRoutes.json('GET /api/projects/:projectId/mr-review', async (req, res) => { try { return res.json(await service().list(req.params.projectId, query(req, 'q'))); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/open', async (req, res) => { try { return res.json(await service().open(req.params.projectId, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('GET /api/projects/:projectId/mr-review/:id', async (req, res) => { try { return res.json(service().detail(req.params.projectId, req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/refresh', async (req, res) => { try { 
    const v = body(req).version;
    if (v !== undefined && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1))
      throw new IntegrationError('Invalid version');
    res.json(await service().refresh(req.params.projectId, req.params.id, v as number | undefined));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('GET /api/projects/:projectId/mr-review/:id/threads', async (req,res) => { try { return res.json(service().threads(req.params.projectId,req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/threads', async (req,res) => { try { return res.json(await service().thread(req.params.projectId,req.params.id,body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/finish', async (req,res) => { try { return res.json(await service().finishReview(req.params.projectId,req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('GET /api/projects/:projectId/mr-review/:id/file', async (req, res) => { try { return res.json(await service().file(req.params.projectId, req.params.id, query(req, 'path') ?? '', query(req, 'head'))); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/drafts', async (req, res) => { try { return res.status(201).json(await service().addDraft(req.params.projectId, req.params.id, body(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('PATCH /api/projects/:projectId/mr-review/:id/drafts/:draft', async (req, res) => { try { return res.json(await service().editDraft(req.params.projectId, req.params.id, req.params.draft, body(req).body)); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('DELETE /api/projects/:projectId/mr-review/:id/drafts/:draft', async (req, res) => { try { return res.json(await service().removeDraft(req.params.projectId, req.params.id, req.params.draft)); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/drafts/:draft/recover', async (req, res) => { try { 
    const d = body(req);
    res.json(await service().recover(req.params.projectId, req.params.id, req.params.draft, d.published, d.confirmed));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/publish', async (req, res) => { try { 
    const d = body(req);
    res.json(await service().publish(req.params.projectId, req.params.id, d.ids, d.confirmed));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/discussions/:discussion/reply', async (req, res) => { try { return res.json(await service().reply(req.params.projectId, req.params.id, req.params.discussion, body(req).body)); } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('POST /api/projects/:projectId/mr-review/:id/approve', async (req, res) => { try { 
    const v = body(req).approved;
    if (typeof v !== 'boolean')
      throw new IntegrationError('Invalid approve');
    res.json(await service().approve(req.params.projectId, req.params.id, v));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  rRoutes.json('PUT /api/projects/:projectId/mr-review/:id/viewed', async (req, res) => { try { 
    const d = body(req);
    res.json(service().viewed(req.params.projectId, req.params.id, d.path, d.viewed));
   } catch (routeError) { return handleRouteError(routeError, res); } });
  return r;
}
export const mrReviewRouter = createMrReviewRouter();

function handleRouteError(e: unknown, res: ErrorResponse) { return res.status(e instanceof IntegrationError ? e.status : 500).json({ error: e instanceof IntegrationError ? e.message : 'Операция ревью не выполнена', code: e instanceof IntegrationError ? e.code : 'internal' }); }
