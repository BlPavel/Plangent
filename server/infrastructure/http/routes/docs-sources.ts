import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';

import { Router, Request, Response } from 'express';
import { createDocsSource, syncDocsSource, cancelDocsSync, isDocsSyncRunning } from '../../../core/docs-sources';
import { DocsSourceError } from '../../../core/docs-sources/types';
import { docsSourcePresets } from '../../../core/docs-sources/presets';
import { IntegrationError, object } from '../../../core/integrations';
import { getProject } from '../../../core/projects';
import { SecretVaultError } from '../../secrets';

export const docsRouter = Router({ mergeParams: true });
const docsRouterRoutes = typedRoutes(docsRouter, '/api/projects/:id/docs');

function configuredSource(req: Request) {
  const body = object(req.body);
  return body.connection_id !== undefined ? createDocsSource(String(body.connection_id), body.config) : source(req);
}
function source(req: Request) {
  const p = getProject(req.params.id);
  if (p?.kind !== 'source' || p.source_type !== 'docs' || !p.connection_id) throw new IntegrationError('Docs source not found', 'not_found', 404);
  return createDocsSource(p.connection_id, p.docs_config);
}
docsRouterRoutes.json('GET /api/projects/:id/docs/presets', (_req, res) => res.json(docsSourcePresets));
docsRouterRoutes.json('POST /api/projects/:id/docs/resolve', async (req, res) => { try { 
  const body = object(req.body);
  if (typeof body.input !== 'string') throw new DocsSourceError('Document link or id is required');
  res.json(await configuredSource(req).resolveLink(body.input));
 } catch (routeError) { return handleRouteError(routeError, res); } });
docsRouterRoutes.json('GET /api/projects/:id/docs/children', async (req, res) => { try { 
  if (typeof req.query.id !== 'string' || !req.query.id) throw new DocsSourceError('Parent id is required');
  res.json(await source(req).listChildren(req.query.id));
 } catch (routeError) { return handleRouteError(routeError, res); } });
docsRouterRoutes.json('POST /api/projects/:id/docs/children', async (req, res) => { try { 
  const body = object(req.body);
  if (typeof body.id !== 'string' || !body.id) throw new DocsSourceError('Parent id is required');
  res.json(await configuredSource(req).listChildren(body.id));
 } catch (routeError) { return handleRouteError(routeError, res); } });
docsRouterRoutes.json('POST /api/projects/:id/docs/probe', async (req, res) => { try { 
  const body = object(req.body), p = getProject(req.params.id);
  const engine = body.connection_id !== undefined ? createDocsSource(String(body.connection_id), body.config) : source(req);
  if (typeof body.input !== 'string') throw new DocsSourceError('Document link or id is required');
  if (p && p.kind !== 'source') throw new DocsSourceError('Reference source required');
  res.json(await engine.probe(body.input));
 } catch (routeError) { return handleRouteError(routeError, res); } });
docsRouterRoutes.json('POST /api/projects/:id/docs/sync', async (req, res) => { try { 
  source(req);
  const body = object(req.body ?? {});
  if (body.confirmed_large !== undefined && typeof body.confirmed_large !== 'boolean') throw new DocsSourceError('confirmed_large must be boolean');
  if (isDocsSyncRunning(req.params.id)) throw new DocsSourceError('Sync already running', 'sync_running');
  void syncDocsSource(req.params.id, { confirmed_large: body.confirmed_large === true }).catch(() => {});
  res.status(202).json({ status: 'running' });
 } catch (routeError) { return handleRouteError(routeError, res); } });
docsRouterRoutes.json('POST /api/projects/:id/docs/cancel', async (req, res) => { try { 
  source(req); await cancelDocsSync(req.params.id);
  res.json(getProject(req.params.id));
 } catch (routeError) { return handleRouteError(routeError, res); } });

function handleRouteError(error: unknown, res: ErrorResponse) {
    if (error instanceof IntegrationError) return res.status(error.status).json({ error: (error as Error).message, code: (error as NodeJS.ErrnoException).code });
    if (error instanceof DocsSourceError) return res.status((error as NodeJS.ErrnoException).code === 'sync_running' ? 409 : 400).json({ error: (error as Error).message, code: (error as NodeJS.ErrnoException).code });
    if (error instanceof SecretVaultError) return res.status(503).json({ error: 'Secret vault unavailable' });
    res.status(500).json({ error: 'Documentation operation failed' });
  }
