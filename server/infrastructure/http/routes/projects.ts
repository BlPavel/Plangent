import { Router, Request, Response } from 'express';
import { listProjects, getProject, createProject, updateProject, deleteProject } from '../../../core/projects';
import { searchFiles } from '../../../core/projects/files';

export const projectsRouter = Router();

projectsRouter.get('/', (_req: Request, res: Response) => {
  res.json(listProjects());
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

projectsRouter.post('/',(req: Request, res: Response) => {
  const { name, repo_path, default_agent_id, config } = req.body;
  if (!name || !repo_path) return res.status(400).json({ error: 'name and repo_path required' });
  const p = createProject({ name, repo_path, default_agent_id, config });
  res.status(201).json(p);
});

projectsRouter.patch('/:id', (req: Request, res: Response) => {
  const p = updateProject(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

projectsRouter.delete('/:id', (req: Request, res: Response) => {
  const ok = deleteProject(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});
