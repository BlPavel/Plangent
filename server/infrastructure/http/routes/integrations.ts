import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { localOrigin } from '../local-origin';
import express, { Router, Request, Response, NextFunction } from 'express';
import * as integrations from '../../../core/integrations';
import { integrationPresets } from '../../../core/integrations/presets';
import { checkConnection } from '../integration-client';
import { getSecretVault, SecretVaultError } from '../../secrets';

export const integrationsRouter = Router();
const integrationsRouterRoutes = typedRoutes(integrationsRouter, '/api/integrations');
integrationsRouter.use(localOrigin);
integrationsRouter.use(express.json({ limit: '1mb', strict: false }));

integrationsRouterRoutes.json('GET /api/integrations/presets', (_req,res) => res.json(integrationPresets));
integrationsRouterRoutes.json('GET /api/integrations/storage', async (_req,res) => { try {  const v = getSecretVault(); res.json({ kind: v.kind,available: v.isAvailable(),insecure_dev_storage: v.kind === 'dev-file' });  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('POST /api/integrations/normalize-url', async (req,res) => { try { 
  const value = integrations.object(req.body).base_url;
  const result = integrations.normalizeBaseUrl(value);
  res.json({ ...result,suggestion: result.normalized ? 'Использовать корень сервиса: ' + result.base_url : null });
 } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('GET /api/integrations/organizations', async (_req,res) => { try { return res.json(integrations.listOrganizations()); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('POST /api/integrations/organizations', async (req,res) => { try { return res.status(201).json(integrations.saveOrganization(req.body)); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('GET /api/integrations/organizations/:id', async (req,res) => { try {  const v = integrations.getOrganization(req.params.id); if (!v) throw new integrations.IntegrationError('Not found','not_found',404); res.json(v);  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('PATCH /api/integrations/organizations/:id', async (req,res) => { try {  if (!integrations.getOrganization(req.params.id)) throw new integrations.IntegrationError('Not found','not_found',404); res.json(integrations.saveOrganization(req.body,req.params.id));  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.empty('DELETE /api/integrations/organizations/:id', async (req,res) => { try {  integrations.deleteOrganization(req.params.id); res.status(204).end();  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('GET /api/integrations/credentials', async (_req,res) => { try { return res.json(integrations.listCredentials()); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('POST /api/integrations/credentials', async (req,res) => { try { return res.status(201).json(integrations.saveCredential(req.body)); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('GET /api/integrations/credentials/:id', async (req,res) => { try {  const v = integrations.getCredential(req.params.id); if (!v) throw new integrations.IntegrationError('Not found','not_found',404); res.json(v);  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('PATCH /api/integrations/credentials/:id', async (req,res) => { try {  if (!integrations.getCredential(req.params.id)) throw new integrations.IntegrationError('Not found','not_found',404); res.json(integrations.saveCredential(req.body,req.params.id));  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('PUT /api/integrations/credentials/:id/password', async (req,res) => { try { return res.json(integrations.setPassword(req.params.id,integrations.object(req.body).password)); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.empty('DELETE /api/integrations/credentials/:id', async (req,res) => { try {  integrations.deleteCredential(req.params.id); res.status(204).end();  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('GET /api/integrations/connections', async (_req,res) => { try { return res.json(integrations.listConnections()); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('POST /api/integrations/connections', async (req,res) => { try { return res.status(201).json(integrations.saveConnection(req.body)); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('GET /api/integrations/connections/:id', async (req,res) => { try { return res.json(integrations.requireConnection(req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('PATCH /api/integrations/connections/:id', async (req,res) => { try {  integrations.requireConnection(req.params.id); res.json(integrations.saveConnection(req.body,req.params.id));  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.empty('DELETE /api/integrations/connections/:id', async (req,res) => { try {  integrations.deleteConnection(req.params.id); res.status(204).end();  } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('GET /api/integrations/connections/:id/credential', async (req,res) => { try { return res.json(integrations.effectiveCredential(integrations.requireConnection(req.params.id))); } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('PUT /api/integrations/connections/:id/password', async (req,res) => { try { 
  const c = integrations.requireConnection(req.params.id);
  if (c.credential_mode !== 'own' || !c.credential_id) throw new integrations.IntegrationError('Use the account password endpoint');
  res.json(integrations.setPassword(c.credential_id,integrations.object(req.body).password));
 } catch (routeError) { return handleRouteError(routeError, res); } });
integrationsRouterRoutes.json('POST /api/integrations/connections/:id/check', async (req,res) => { try { return res.json(await checkConnection(req.params.id)); } catch (routeError) { return handleRouteError(routeError, res); } });

integrationsRouter.use((error: unknown,_req: Request,res: Response,_next: NextFunction) => {
  const status = (error as { status?: number })?.status === 413 ? 413 : 400;
  res.status(status).json({ error: 'Некорректный JSON запроса',code: 'validation' });
});

function handleRouteError(error: unknown, res: ErrorResponse) {
    if (error instanceof integrations.IntegrationError) return res.status(error.status).json({ error: (error as Error).message,code: (error as NodeJS.ErrnoException).code });
    if (error instanceof SecretVaultError) return res.status(503).json({ error: 'Хранилище секретов недоступно',code: 'vault_unavailable' });
    // Never expose database errors, ciphertext or a remote response to the client.
    res.status(500).json({ error: 'Ошибка интеграции',code: 'internal' });
  }
