import { Router, Request, Response } from 'express';
import {
  listLibraryItems, getLibraryItem, createLibraryItem, updateLibraryItem, deleteLibraryItem,
  setLibraryOverride, deleteLibraryOverride, libraryItemsFor, libraryOrigin, setExcluded,
} from '../../../core/library';
import { getProject } from '../../../core/projects';
import { readItemContent, writeItemContent, deleteItemContent, writeOverrideContent, readOverrideContent, deleteOverrideContent } from '../../../core/library/library-manager';
import { DEFAULT_CODE_FIXER_INSTRUCTION } from '../../../core/library/code-fixer-instruction';
import { DEFAULT_INSTRUCTION_GUIDE } from '../../../core/library/instruction-guide';
import { PLAN_PROTOCOL_LOCKED } from '../../../core/library/plan-template';
import { syncItem, unsyncItem, syncAll } from '../../../core/library/syncer';
import { LibraryItemType, LibraryScope } from '../../../models';

import { listProposals, applyProposal, rejectProposal, ProposalConflict } from '../../../core/library/proposals';

export const libraryRouter = Router();

libraryRouter.get('/proposals', (req: Request, res: Response) => {
  res.json(listProposals({
    projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
    sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
  }));
});
libraryRouter.post('/proposals/:proposalId/apply', (req: Request, res: Response) => {
  try {
    const item = applyProposal(req.params.proposalId, req.body.availability);
    res.json(item);
  } catch (e) {
    res.status(e instanceof ProposalConflict ? 409 : 400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
libraryRouter.post('/proposals/:proposalId/reject', (req: Request, res: Response) => {
  try { res.json(rejectProposal(req.params.proposalId)); }
  catch (e) { res.status(e instanceof ProposalConflict ? 409 : 400).json({ error: e instanceof Error ? e.message : String(e) }); }
});



libraryRouter.get('/code-fixer-instruction/defaults', (_req: Request, res: Response) => {
  res.json({ content: DEFAULT_CODE_FIXER_INSTRUCTION });
});

libraryRouter.get('/instruction-guide/defaults', (_req: Request, res: Response) => {
  res.json({ content: DEFAULT_INSTRUCTION_GUIDE });
});

libraryRouter.get('/plan-template/defaults', (_req: Request, res: Response) => {
  res.json({
    lockedProtocol: PLAN_PROTOCOL_LOCKED,
  });
});

libraryRouter.get('/', (req: Request, res: Response) => {
  const { type, scope, projectId, forProject } = req.query;
  // Everything that applies to a project or group, with its origin (global / group / direct).
  if (typeof forProject === 'string') {
    const project = getProject(forProject);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    return res.json(libraryItemsFor(project, type as LibraryItemType | undefined));
  }
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
  const targets: string[] = Array.isArray(req.body.targets) ? req.body.targets : project_id ? [project_id] : [];
  const own_only: string[] = Array.isArray(req.body.own_only) ? req.body.own_only : [];
  // Only one main file / plan template / instruction guide per level.
  if (type === 'main' || type === 'plan-template' || type === 'instruction-guide' || type === 'code-fixer-instruction') {
    const clash = listLibraryItems({ type, scope }).some(other => scope === 'global' || other.targets.some(t => targets.includes(t)));
    if (clash) {
      return res.status(409).json({ error: type === 'code-fixer-instruction' ? 'Инструкция агента доработки для этого уровня уже существует' : type === 'main' ? 'Главный файл для этого уровня уже существует' : type === 'plan-template' ? 'Шаблон плана для этого уровня уже существует' : 'Руководство по инструкциям для этого уровня уже существует' });
    }
  }
  const item = createLibraryItem({ type, slug, title, description, scope, targets, own_only, frontmatter, agent_filter, enabled });
  if (content !== undefined) writeItemContent(item, content);
  try { syncItem(item); } catch (e) { console.error('[library] syncItem error:', e); }
  res.status(201).json({ ...item, content: content ?? '' });
});

libraryRouter.put('/:id', (req: Request, res: Response) => {
  const { content, ...rest } = req.body;
  const before = getLibraryItem(req.params.id);
  const updated = updateLibraryItem(req.params.id, rest);
  if (!before || !updated) return res.status(404).json({ error: 'Not found' });
  // Availability changed: take the files away from where the item no longer applies.
  if (before.scope !== updated.scope || before.targets.join() !== updated.targets.join() || before.own_only.join() !== updated.own_only.join()) {
    try { unsyncItem(before); } catch (e) { console.error('[library] unsyncItem error:', e); }
  }
  if (content !== undefined) writeItemContent(updated, content);
  try { syncItem(updated); } catch (e) { console.error('[library] syncItem error:', e); }
  res.json({ ...updated, content: content ?? readItemContent(updated) });
});

// A group's item changed or deleted inside one project stops being shared there: the project gets its own copy
// (or nothing), and the group's item stays as it was for everyone else.
function projectOfSharedItem(req: Request, res: Response) {
  const item = getLibraryItem(req.params.id);
  const project = getProject(String(req.body.projectId ?? ''));
  if (!item || !project) { res.status(404).json({ error: 'Not found' }); return null; }
  if (!libraryOrigin(item, project) || !project.group_id || !item.targets.includes(project.group_id)) { res.status(400).json({ error: 'Элемент не получен через группу' }); return null; }
  return { item, project };
}

libraryRouter.post('/:id/detach', (req: Request, res: Response) => {
  const found = projectOfSharedItem(req, res);
  if (!found) return;
  const { item, project } = found;
  const copy = createLibraryItem({
    type: item.type, slug: item.slug, title: item.title, description: item.description, scope: 'project', targets: [project.id],
    frontmatter: item.frontmatter, agent_filter: item.agent_filter, enabled: item.enabled, detached_from: item.id,
  });
  writeItemContent(copy, readItemContent(item));
  try { unsyncItem(item, [project]); } catch (e) { console.error('[library] unsyncItem error:', e); }
  setExcluded(item.id, project.id, true);
  try { syncItem(copy); } catch (e) { console.error('[library] syncItem error:', e); }
  res.status(201).json({ ...copy, content: readItemContent(copy) });
});

libraryRouter.post('/:id/exclude', (req: Request, res: Response) => {
  const found = projectOfSharedItem(req, res);
  if (!found) return;
  try { unsyncItem(found.item, [found.project]); } catch (e) { console.error('[library] unsyncItem error:', e); }
  setExcluded(found.item.id, found.project.id, true);
  res.json({ ok: true });
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
