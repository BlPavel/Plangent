import { localOrigin } from '../local-origin';
import express, { Router, Request, Response, NextFunction } from 'express';
import * as integrations from '../../../core/integrations';
import { integrationPresets } from '../../../core/integrations/presets';
import { checkConnection } from '../integration-client';
import { getSecretVault, SecretVaultError } from '../../secrets';

export const integrationsRouter = Router();
integrationsRouter.use(localOrigin);
integrationsRouter.use(express.json({ limit: '1mb', strict: false }));
const guard = (handler: (req: Request,res: Response) => unknown) => (req: Request,res: Response,next: NextFunction) => {
  Promise.resolve().then(() => handler(req,res)).catch(error => {
    if (error instanceof integrations.IntegrationError) return res.status(error.status).json({ error: error.message,code: error.code });
    if (error instanceof SecretVaultError) return res.status(503).json({ error: 'Хранилище секретов недоступно',code: 'vault_unavailable' });
    // Never expose database errors, ciphertext or a remote response to the client.
    res.status(500).json({ error: 'Ошибка интеграции',code: 'internal' });
  });
};
integrationsRouter.get('/presets',(_req,res) => res.json(integrationPresets));
integrationsRouter.get('/storage',guard((_req,res) => { const v = getSecretVault(); res.json({ kind: v.kind,available: v.isAvailable(),insecure_dev_storage: v.kind === 'dev-file' }); }));
integrationsRouter.post('/normalize-url',guard((req,res) => {
  const value = integrations.object(req.body).base_url;
  const result = integrations.normalizeBaseUrl(value);
  res.json({ ...result,suggestion: result.normalized ? 'Использовать корень сервиса: ' + result.base_url : null });
}));
integrationsRouter.get('/organizations',guard((_req,res) => res.json(integrations.listOrganizations())));
integrationsRouter.post('/organizations',guard((req,res) => res.status(201).json(integrations.saveOrganization(req.body))));
integrationsRouter.get('/organizations/:id',guard((req,res) => { const v = integrations.getOrganization(req.params.id); if (!v) throw new integrations.IntegrationError('Not found','not_found',404); res.json(v); }));
integrationsRouter.patch('/organizations/:id',guard((req,res) => { if (!integrations.getOrganization(req.params.id)) throw new integrations.IntegrationError('Not found','not_found',404); res.json(integrations.saveOrganization(req.body,req.params.id)); }));
integrationsRouter.delete('/organizations/:id',guard((req,res) => { integrations.deleteOrganization(req.params.id); res.status(204).end(); }));
integrationsRouter.get('/credentials',guard((_req,res) => res.json(integrations.listCredentials())));
integrationsRouter.post('/credentials',guard((req,res) => res.status(201).json(integrations.saveCredential(req.body))));
integrationsRouter.get('/credentials/:id',guard((req,res) => { const v = integrations.getCredential(req.params.id); if (!v) throw new integrations.IntegrationError('Not found','not_found',404); res.json(v); }));
integrationsRouter.patch('/credentials/:id',guard((req,res) => { if (!integrations.getCredential(req.params.id)) throw new integrations.IntegrationError('Not found','not_found',404); res.json(integrations.saveCredential(req.body,req.params.id)); }));
integrationsRouter.put('/credentials/:id/password',guard((req,res) => res.json(integrations.setPassword(req.params.id,integrations.object(req.body).password))));
integrationsRouter.delete('/credentials/:id',guard((req,res) => { integrations.deleteCredential(req.params.id); res.status(204).end(); }));
integrationsRouter.get('/connections',guard((_req,res) => res.json(integrations.listConnections())));
integrationsRouter.post('/connections',guard((req,res) => res.status(201).json(integrations.saveConnection(req.body))));
integrationsRouter.get('/connections/:id',guard((req,res) => res.json(integrations.requireConnection(req.params.id))));
integrationsRouter.patch('/connections/:id',guard((req,res) => { integrations.requireConnection(req.params.id); res.json(integrations.saveConnection(req.body,req.params.id)); }));
integrationsRouter.delete('/connections/:id',guard((req,res) => { integrations.deleteConnection(req.params.id); res.status(204).end(); }));
integrationsRouter.get('/connections/:id/credential',guard((req,res) => res.json(integrations.effectiveCredential(integrations.requireConnection(req.params.id)))));
integrationsRouter.put('/connections/:id/password',guard((req,res) => {
  const c = integrations.requireConnection(req.params.id);
  if (c.credential_mode !== 'own' || !c.credential_id) throw new integrations.IntegrationError('Use the account password endpoint');
  res.json(integrations.setPassword(c.credential_id,integrations.object(req.body).password));
}));
integrationsRouter.post('/connections/:id/check',guard(async (req,res) => res.json(await checkConnection(req.params.id))));

integrationsRouter.use((error: unknown,_req: Request,res: Response,_next: NextFunction) => {
  const status = (error as { status?: number })?.status === 413 ? 413 : 400;
  res.status(status).json({ error: 'Некорректный JSON запроса',code: 'validation' });
});
