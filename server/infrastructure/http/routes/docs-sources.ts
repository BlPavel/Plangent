
import { Router, Request, Response } from 'express';
import { createDocsSource, syncDocsSource, cancelDocsSync, isDocsSyncRunning } from '../../../core/docs-sources';
import { DocsSourceError } from '../../../core/docs-sources/types';
import { docsSourcePresets } from '../../../core/docs-sources/presets';
import { IntegrationError, object } from '../../../core/integrations';
import { getProject } from '../../../core/projects';
import { SecretVaultError } from '../../secrets';

export const docsRouter = Router({ mergeParams: true });
const guard = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
  Promise.resolve().then(() => handler(req, res)).catch(error => {
    if (error instanceof IntegrationError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof DocsSourceError) return res.status(error.code === 'sync_running' ? 409 : 400).json({ error: error.message, code: error.code });
    if (error instanceof SecretVaultError) return res.status(503).json({ error: 'Secret vault unavailable' });
    res.status(500).json({ error: 'Documentation operation failed' });
  });
};
function configuredSource(req: Request) {
  const body = object(req.body);
  return body.connection_id !== undefined ? createDocsSource(String(body.connection_id), body.config) : source(req);
}
function source(req: Request) {
  const p = getProject(req.params.id);
  if (p?.kind !== 'source' || p.source_type !== 'docs' || !p.connection_id) throw new IntegrationError('Docs source not found', 'not_found', 404);
  return createDocsSource(p.connection_id, p.docs_config);
}
docsRouter.get('/presets', (_req, res) => res.json(docsSourcePresets));
docsRouter.post('/resolve', guard(async (req, res) => {
  const body = object(req.body);
  if (typeof body.input !== 'string') throw new DocsSourceError('Document link or id is required');
  res.json(await configuredSource(req).resolveLink(body.input));
}));
docsRouter.get('/children', guard(async (req, res) => {
  if (typeof req.query.id !== 'string' || !req.query.id) throw new DocsSourceError('Parent id is required');
  res.json(await source(req).listChildren(req.query.id));
}));
docsRouter.post('/children', guard(async (req, res) => {
  const body = object(req.body);
  if (typeof body.id !== 'string' || !body.id) throw new DocsSourceError('Parent id is required');
  res.json(await configuredSource(req).listChildren(body.id));
}));
docsRouter.post('/probe', guard(async (req, res) => {
  const body = object(req.body), p = getProject(req.params.id);
  const engine = body.connection_id !== undefined ? createDocsSource(String(body.connection_id), body.config) : source(req);
  if (typeof body.input !== 'string') throw new DocsSourceError('Document link or id is required');
  if (p && p.kind !== 'source') throw new DocsSourceError('Reference source required');
  res.json(await engine.probe(body.input));
}));
docsRouter.post('/sync', guard((req, res) => {
  source(req);
  const body = object(req.body ?? {});
  if (body.confirmed_large !== undefined && typeof body.confirmed_large !== 'boolean') throw new DocsSourceError('confirmed_large must be boolean');
  if (isDocsSyncRunning(req.params.id)) throw new DocsSourceError('Sync already running', 'sync_running');
  void syncDocsSource(req.params.id, { confirmed_large: body.confirmed_large === true }).catch(() => {});
  res.status(202).json({ status: 'running' });
}));
docsRouter.post('/cancel', guard(async (req, res) => {
  source(req); await cancelDocsSync(req.params.id);
  res.json(getProject(req.params.id));
}));
