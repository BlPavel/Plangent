import { Router, Request, Response } from 'express';
import {
  listLibraryItems, getLibraryItem, createLibraryItem, updateLibraryItem, deleteLibraryItem,
  setLibraryOverride, getLibraryOverride, deleteLibraryOverride,
} from '../../storage/library';
import { readItemContent, writeItemContent, deleteItemContent, writeOverrideContent, readOverrideContent, deleteOverrideContent } from '../../skills/library-manager';
import { syncItem, unsyncItem, syncAll } from '../../skills/syncer';
import { LibraryItemType, LibraryScope } from '../../models/types';

export const libraryRouter = Router();

libraryRouter.get('/', (req: Request, res: Response) => {
  const { type, scope, projectId } = req.query;
  const items = listLibraryItems({
    type: type as LibraryItemType | undefined,
    scope: scope as LibraryScope | undefined,
    projectId: projectId as string | undefined,
  });
  res.json(items);
});

libraryRouter.get('/:id', (req: Request, res: Response) => {
  const item = getLibraryItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const content = readItemContent(item);
  res.json({ ...item, content });
});

libraryRouter.post('/', (req: Request, res: Response) => {
  const { type, slug, title, description, scope, project_id, frontmatter, agent_filter, enabled, content } = req.body;
  if (!type || !slug || !title || !scope) {
    return res.status(400).json({ error: 'type, slug, title, scope required' });
  }
  // Only one main file is allowed per scope (global / per-project)
  if (type === 'main') {
    const existing = listLibraryItems({ type: 'main', scope, projectId: scope === 'project' ? (project_id ?? undefined) : '' });
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Главный файл для этого уровня уже существует' });
    }
  }
  const item = createLibraryItem({ type, slug, title, description, scope, project_id, frontmatter, agent_filter, enabled });
  if (content !== undefined) writeItemContent(item, content);
  try { syncItem(item); } catch (e) { console.error('[library] syncItem error:', e); }
  res.status(201).json({ ...item, content: content ?? '' });
});

libraryRouter.put('/:id', (req: Request, res: Response) => {
  const { content, ...rest } = req.body;
  const updated = updateLibraryItem(req.params.id, rest);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  if (content !== undefined) writeItemContent(updated, content);
  try { syncItem(updated); } catch (e) { console.error('[library] syncItem error:', e); }
  res.json({ ...updated, content: content ?? readItemContent(updated) });
});

libraryRouter.delete('/:id', (req: Request, res: Response) => {
  const item = getLibraryItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  try { unsyncItem(item); } catch (e) { console.error('[library] unsyncItem error:', e); }
  deleteItemContent(item);
  deleteLibraryItem(item.id);
  res.json({ ok: true });
});

// Override content for specific agent type
libraryRouter.get('/:id/overrides/:agentType', (req: Request, res: Response) => {
  const item = getLibraryItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const content = readOverrideContent(item, req.params.agentType);
  res.json({ content: content ?? null });
});

libraryRouter.put('/:id/overrides/:agentType', (req: Request, res: Response) => {
  const item = getLibraryItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  writeOverrideContent(item, req.params.agentType, content);
  setLibraryOverride(item.id, req.params.agentType, req.params.agentType);
  try { syncItem(item); } catch (e) { console.error('[library] syncItem error:', e); }
  res.json({ ok: true });
});

libraryRouter.delete('/:id/overrides/:agentType', (req: Request, res: Response) => {
  const item = getLibraryItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  deleteOverrideContent(item, req.params.agentType);
  deleteLibraryOverride(item.id, req.params.agentType);
  try { syncItem(item); } catch (e) { console.error('[library] syncItem error:', e); }
  res.json({ ok: true });
});

// Manual full re-sync
libraryRouter.post('/sync', (_req: Request, res: Response) => {
  try {
    syncAll();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
