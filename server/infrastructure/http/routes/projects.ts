import { defaultGitSettings } from '../../../core/projects/git-settings';
import { resolveCodeHost } from '../../../core/code-hosts';
import { localOrigin } from '../local-origin';
import { randomUUID } from 'node:crypto';
import { broadcast } from '../../../core/shared/events';
import { GitOperationError } from '../../../core/code/git-write';
import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import { pathToFileURL } from 'url';
import { listProjects, getProject, getProjectByKey, createProjectFromFolder, ExistingCloneError, updateProject, deleteProject, groupMembers, inspectProjectGit, effectiveGitSettings, ProjectError } from '../../../core/projects';
import { searchFiles } from '../../../core/projects/files';
import { resyncAfterRegroup } from '../../../core/library/syncer';
import { getDb } from '../../db/schema';
import { docsRouter } from './docs-sources';
import { cancelDocsSync } from '../../../core/docs-sources';
import { DocsSourceError } from '../../../core/docs-sources/types';
import { IntegrationError } from '../../../core/integrations';
import { Project } from '../../../models';

export const projectsRouter = Router();
projectsRouter.use(localOrigin);
projectsRouter.use('/:id/docs', docsRouter);

const guard = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {

  Promise.resolve().then(() => handler(req, res)).catch(e => {
    if (e instanceof ProjectError || e instanceof DocsSourceError) return res.status(400).json({ error: e.message, ...(e instanceof ExistingCloneError ? { code: e.code } : {}) });
    if (e instanceof IntegrationError) return res.status(e.status).json({ error: e.message, code: e.code });
    if (e instanceof GitOperationError) return res.status(e.status).json({ error: e.message, output: e.output, code: e.code });
    res.status(500).json({ error: 'Project operation failed' });
  });

};

projectsRouter.get('/', (_req: Request, res: Response) => {
  // Open tasks per project, for the sidebar's «hide projects without active tasks».
  const active = new Map((getDb().prepare(`SELECT project_id, COUNT(*) AS n FROM tasks WHERE status <> 'done' GROUP BY project_id`).all() as { project_id: string; n: number }[])
    .map(r => [r.project_id, r.n]));
  res.json(listProjects().map(p => ({ ...p, active_tasks: active.get(p.id) ?? 0 })));
});

projectsRouter.post('/git-preview', guard(async (req, res) => res.json(await inspectProjectGit(req.body?.repo_path))));

projectsRouter.get('/git-defaults', (_req, res) => res.json({ values: defaultGitSettings, sources: Object.fromEntries(Object.keys(defaultGitSettings).map(key => [key, 'default'])) }));
projectsRouter.get('/:id', (req: Request, res: Response) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

projectsRouter.get('/:id/host-members', guard(async (req, res) => res.json(await (await resolveCodeHost(req.params.id)).host.listMembers())));
projectsRouter.get('/:id/git-settings', guard((req, res) => res.json(effectiveGitSettings(req.params.id))));

projectsRouter.get('/:id/files', async (req: Request, res: Response) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  try { res.json(await searchFiles(p.repo_path, typeof req.query.q === 'string' ? req.query.q : '')); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

interface Mention { path: string; dir: boolean; uri: string; ref?: boolean; section?: 'members' | 'sources' | 'projects'; detail?: string }

/**
 * Suggestions for the composer's @: the project's own files first, then reference material (sources and other
 * projects, by key) at the end. `key/…` searches inside that source. A group has no files of its own, so its
 * projects come first instead.
 */
projectsRouter.get('/:id/mentions', async (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  const q = (typeof req.query.q === 'string' ? req.query.q : '').replace(/\\/g, '/');
  try {
    const slash = q.indexOf('/');
    const inside = slash > 0 ? getProjectByKey(q.slice(0, slash)) : null;
    if (inside && inside.id !== project.id) {
      const hits = await searchFiles(inside.repo_path, q.slice(slash + 1));
      return res.json(hits.map(h => ({ ...h, path: `${inside.key}/${h.path}` })));
    }
    const root = (p: Project, ref = true): Mention => ({
      path: `${p.key}/`, dir: true, uri: pathToFileURL(path.resolve(p.repo_path)).href, ref, detail: p.name,
      section: !ref ? 'members' : p.kind === 'source' ? 'sources' : 'projects',
    });
    const needle = q.toLowerCase();
    const matches = (p: Project) => !needle || p.key!.includes(needle) || p.name.toLowerCase().includes(needle);
    const members = project.kind === 'group' ? groupMembers(project.id) : [];
    const own: Mention[] = project.kind === 'group' ? members.filter(matches).map(p => root(p, false)) : await searchFiles(project.repo_path, q);
    const refs = listProjects().filter(p => p.kind !== 'group' && p.id !== project.id && !members.some(m => m.id === p.id) && matches(p))
      .sort((a, b) => Number(b.kind === 'source') - Number(a.kind === 'source') || a.key!.localeCompare(b.key!)).map(p => root(p));
    res.json([...own, ...refs]);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

const clones = new Map<string, AbortController>();
projectsRouter.post('/clone-cancel', guard((req, res) => {
  const controller = clones.get(req.body?.operationId);
  if (!controller) return res.status(404).json({ error: 'Clone not found' });
  controller.abort(); res.status(204).end();
}));
projectsRouter.post('/', guard(async (req: Request, res: Response) => {
  if (req.body?.creation_mode !== undefined && !['folder', 'clone'].includes(req.body.creation_mode)) throw new ProjectError('Invalid creation mode');
  const operationId = req.body?.operationId ?? randomUUID();
  if (typeof operationId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(operationId) || clones.has(operationId)) throw new ProjectError('Invalid operation ID');
  const controller = new AbortController(); clones.set(operationId, controller);
  const cancel = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', cancel);
  let p: Project;
  try {
    p = await createProjectFromFolder(req.body, req.body?.creation_mode === 'clone', {
      reuseExisting: req.body?.reuse_existing === true, signal: controller.signal,
      onOutput: output => broadcast({ type: 'project:clone-progress', operationId, output }),
    });
  } finally { clones.delete(operationId); res.off('close', cancel); }

  if (p.group_id) resyncAfterRegroup({ ...p, group_id: null }, p);
  res.status(201).json(p);
}));

projectsRouter.patch('/:id', guard((req: Request, res: Response) => {
  const before = getProject(req.params.id);
  const p = updateProject(req.params.id, req.body);
  if (!before || !p) return res.status(404).json({ error: 'Not found' });
  try { resyncAfterRegroup(before, p); } catch (e) { console.error('[library] resync error:', e); }
  res.json(p);
}));

projectsRouter.delete('/:id', guard(async (req: Request, res: Response) => {
  await cancelDocsSync(req.params.id);
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  // The projects stay and leave the group, losing what it shared with them.
  if (p.kind === 'group') {
    for (const member of groupMembers(p.id)) {
      try { resyncAfterRegroup(member, { ...member, group_id: null }); } catch (e) { console.error('[library] resync error:', e); }
    }
  }
  deleteProject(p.id);
  res.status(204).end();
}));
