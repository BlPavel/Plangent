import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import { pathToFileURL } from 'url';
import { listProjects, getProject, getProjectByKey, createProject, updateProject, deleteProject, groupMembers, ProjectError } from '../../../core/projects';
import { searchFiles } from '../../../core/projects/files';
import { resyncAfterRegroup } from '../../../core/library/syncer';
import { getDb } from '../../db/schema';
import { Project } from '../../../models';

export const projectsRouter = Router();

const guard = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try { return handler(req, res); }
  catch (e) { if (e instanceof ProjectError) return res.status(400).json({ error: e.message }); next(e); }
};

projectsRouter.get('/', (_req: Request, res: Response) => {
  // Open tasks per project, for the sidebar's «hide projects without active tasks».
  const active = new Map((getDb().prepare(`SELECT project_id, COUNT(*) AS n FROM tasks WHERE status <> 'done' GROUP BY project_id`).all() as { project_id: string; n: number }[])
    .map(r => [r.project_id, r.n]));
  res.json(listProjects().map(p => ({ ...p, active_tasks: active.get(p.id) ?? 0 })));
});

projectsRouter.get('/:id', (req: Request, res: Response) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

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

projectsRouter.post('/', guard((req: Request, res: Response) => {
  const { kind, name, key, repo_path, group_id, icon, description, default_agent_id, config, targets } = req.body;
  const p = createProject({ kind, name, key, repo_path, group_id, icon, description, default_agent_id, config, targets });
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

projectsRouter.delete('/:id', (req: Request, res: Response) => {
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
});
