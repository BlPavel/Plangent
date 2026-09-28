import { Router, Request, Response } from 'express';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent, updateAgentCli } from '../../../core/agents';
import { agentLimits } from '../../../core/agents/limits';
import { agentOptions } from '../../../core/agent-sessions/acp-host';

export const agentsRouter = Router();

agentsRouter.get('/', (_req: Request, res: Response) => {
  res.json(listAgents());
});

agentsRouter.get('/:id', (req: Request, res: Response) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

agentsRouter.get('/:id/limits', async (req: Request, res: Response) => {
  try { res.json(await agentLimits(req.params.id, req.query.refresh === '1')); }
  catch (e) { res.status(404).json({ error: String(e) }); }
});

agentsRouter.get('/:id/acp-options', async (req: Request, res: Response) => {
  try { res.json(await agentOptions(req.params.id, req.query.refresh === '1')); }
  catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : String(e) }); }
});

agentsRouter.post('/',(req: Request, res: Response) => {
  const { name, command, update_command, args, env, skills_dir, skills_filename, model, reasoning_effort, model_options, reasoning_options } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'name and command required' });
  const a = createAgent({ acp_command: req.body.acp_command, acp_args: req.body.acp_args, name, command, update_command, args, env, skills_dir, skills_filename, model, reasoning_effort, model_options, reasoning_options });
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
  try {
    const ok = deleteAgent(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'У агента есть чаты — удалите их во вкладке «Агенты» (чат) и повторите попытку' });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Не удалось удалить агента' });
  }
});
