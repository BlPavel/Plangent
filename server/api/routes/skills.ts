import { Router, Request, Response } from 'express';
import { readCommonSkills, readProjectSkills, saveCommonSkills, saveProjectSkills } from '../../skills/manager';

export const skillsRouter = Router();

skillsRouter.get('/common', (_req: Request, res: Response) => {
  const content = readCommonSkills();
  if (content === null) return res.status(404).json({ error: 'No common skills defined' });
  res.json({ content });
});

skillsRouter.put('/common', (req: Request, res: Response) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  saveCommonSkills(content);
  res.json({ ok: true });
});

skillsRouter.get('/projects/:projectId', (req: Request, res: Response) => {
  const content = readProjectSkills(req.params.projectId);
  if (content === null) return res.status(404).json({ error: 'No project skills defined' });
  res.json({ content });
});

skillsRouter.put('/projects/:projectId', (req: Request, res: Response) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  saveProjectSkills(req.params.projectId, content);
  res.json({ ok: true });
});
