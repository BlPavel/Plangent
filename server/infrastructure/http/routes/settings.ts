import { Router, Request, Response } from 'express';
import { getDb } from '../../db/schema';

export const settingsRouter = Router();

// Free-form app-level values (e.g. the user's own "things to fix" notes), stored as text.
const KEYS = new Set(['improvement-notes']);

settingsRouter.get('/:key', (req: Request, res: Response) => {
  if (!KEYS.has(req.params.key)) return res.status(404).json({ error: 'Unknown setting' });
  const row = getDb().prepare('SELECT value, updated_at FROM app_settings WHERE key = ?').get(req.params.key) as { value: string; updated_at: string } | undefined;
  res.json({ value: row?.value ?? '', updated_at: row?.updated_at ?? null });
});

settingsRouter.put('/:key', (req: Request, res: Response) => {
  if (!KEYS.has(req.params.key)) return res.status(404).json({ error: 'Unknown setting' });
  const value = req.body?.value;
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a string' });
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(req.params.key, value);
  res.json({ ok: true });
});
