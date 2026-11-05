import { typedRoutes } from '../typed-route';
import { Router, Request, Response } from 'express';
import { readSetting, writeSetting } from '../../../core/settings';

export const settingsRouter = Router();
const settingsRouterRoutes = typedRoutes(settingsRouter, '/api/settings');

// Free-form app-level values (e.g. the user's own "things to fix" notes), stored as text.
const KEYS = new Set(['improvement-notes']);

settingsRouterRoutes.json('GET /api/settings/:key', (req, res) => {
  if (!KEYS.has(req.params.key)) return res.status(404).json({ error: 'Unknown setting' });
  res.json(readSetting(req.params.key));
});

settingsRouterRoutes.json('PUT /api/settings/:key', (req, res) => {
  if (!KEYS.has(req.params.key)) return res.status(404).json({ error: 'Unknown setting' });
  const value = req.body?.value;
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
  writeSetting(req.params.key, value);
  res.json({ ok: true });
});
