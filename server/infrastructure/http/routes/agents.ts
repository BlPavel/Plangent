import { Router, Request, Response } from 'express';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent, updateAgentCli } from '../../../core/agents';

export const agentsRouter = Router();

agentsRouter.get('/', (_req: Request, res: Response) => {
  res.json(listAgents());
});

agentsRouter.get('/:id', (req: Request, res: Response) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

agentsRouter.post('/', (req: Request, res: Response) => {
  const { name, command, update_command, args, env, skills_dir, skills_filename, model, reasoning_effort, model_options, reasoning_options } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'name and command required' });
  const a = createAgent({ name, command, update_command, args, env, skills_dir, skills_filename, model, reasoning_effort, model_options, reasoning_options });
  res.status(201).json(a);
});

agentsRouter.patch('/:id', (req: Request, res: Response) => {
  const a = updateAgent(req.params.id, req.body);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

agentsRouter.post('/:id/update', async (req: Request, res: Response) => {
  try {
    res.json(await updateAgentCli(req.params.id));
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Не удалось обновить агента' });
  }
});

agentsRouter.delete('/:id', (req: Request, res: Response) => {
  const ok = deleteAgent(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});
