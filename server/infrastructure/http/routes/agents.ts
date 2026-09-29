import { Router, Request, Response } from 'express';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent, updateAgentCli, type AgentInput } from '../../../core/agents';
import { agentLimits } from '../../../core/agents/limits';
import { agentPresets } from '../../../core/agents/presets';
import { getAcpOptions } from '../../../core/agents/acp-options';
import { agentOptions } from '../../../core/agent-sessions/acp-host';

export const agentsRouter = Router();

agentsRouter.get('/', (_req: Request, res: Response) => {
  res.json(listAgents());
});

agentsRouter.get('/presets', (_req: Request, res: Response) => {
  res.json(agentPresets);
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
  if (req.query.cached === '1') return res.json(getAcpOptions(req.params.id));
  try { res.json(await agentOptions(req.params.id, req.query.refresh === '1')); }
  catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : String(e) }); }
});

const FIELDS = ['name', 'acp_command', 'acp_args', 'env', 'command', 'update_command', 'layout_profile', 'model', 'reasoning_effort', 'active'] as const;
const pick = (body: Record<string, unknown>) => Object.fromEntries(FIELDS.filter(f => body[f] !== undefined).map(f => [f, body[f]])) as Partial<AgentInput>;

agentsRouter.post('/',(req: Request, res: Response) => {
  const data = pick(req.body);
  if (!data.name?.trim()) return res.status(400).json({ error: 'Укажите название агента' });
  if (!data.acp_command?.trim()) return res.status(400).json({ error: 'Укажите команду ACP-адаптера' });
  try { res.status(201).json(createAgent(data as AgentInput)); }
  catch (e) { res.status(400).json({ error: /UNIQUE/.test(String(e)) ? 'Агент с таким названием уже есть' : String(e) }); }
});

agentsRouter.patch('/:id', (req: Request, res: Response) => {
  const a = updateAgent(req.params.id, pick(req.body));
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
