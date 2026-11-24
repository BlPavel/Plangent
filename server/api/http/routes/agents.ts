import { typedRoutes } from '../typed-route';
import { Router, Request, Response } from 'express';
import { listAgents, getAgent, createAgent, updateAgent, updateAgentCli, agentCliStatus, installAgentCliForAgent, agentInstallPlan,
  AgentCliMissingError, type AgentInput } from '../../../core/agents/catalog';
import { agentLimits } from '../../../core/agents/catalog/limits';
import { agentPresets } from '../../../core/agents/catalog/presets';
import { DomainError } from '../../../models/domain-error';
import { agentOptions, cachedAgentOptions, prepareAgentProxyChange, deleteAgent } from '../../../core/agents';

export const agentsRouter = Router();
const agentsRouterRoutes = typedRoutes(agentsRouter, '/api/agents');

agentsRouterRoutes.json('GET /api/agents', (_req, res) => {
  res.json(listAgents());
});

agentsRouterRoutes.json('GET /api/agents/presets', (_req, res) => {
  res.json(agentPresets);
});

agentsRouterRoutes.json('GET /api/agents/:id', (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

agentsRouterRoutes.json('GET /api/agents/:id/limits', async (req, res) => {
  try { res.json(await agentLimits(req.params.id, req.query.refresh === '1')); }
  catch (e) { res.status(404).json({ error: String(e) }); }
});

agentsRouterRoutes.json('GET /api/agents/:id/acp-options', async (req, res) => {
  if (req.query.cached === '1') return res.json(cachedAgentOptions(req.params.id));
  try { res.json(await agentOptions(req.params.id, req.query.refresh === '1')); }
  catch (e) {
    if (e instanceof AgentCliMissingError) return res.status(502).json({ error: e.message, code: e.code, detail: e.command, install: e.install });
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

agentsRouterRoutes.json('GET /api/agents/:id/cli', async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  try { res.json(await agentCliStatus(agent)); }
  catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

agentsRouterRoutes.json('POST /api/agents/:id/cli/install', async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  if (!agentInstallPlan(agent)) {
    return res.status(409).json({ error: 'Для этого агента нет команды автоматической установки. Установите CLI вручную.', code: 'agent_cli_unavailable' });
  }
  void installAgentCliForAgent(agent).catch(() => {});
  try { res.status(202).json(await agentCliStatus(agent)); }
  catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

const FIELDS = ['name', 'acp_command', 'acp_args', 'env', 'command', 'update_command', 'layout_profile', 'model', 'reasoning_effort', 'active', 'use_proxy'] as const;
const pick = (body: Record<string, unknown>) => Object.fromEntries(FIELDS.filter(f => body[f] !== undefined).map(f => [f, body[f]])) as Partial<AgentInput>;

agentsRouterRoutes.json('POST /api/agents', (req, res) => {
  if (req.body?.use_proxy !== undefined && typeof req.body.use_proxy !== 'boolean') return res.status(400).json({ error: 'use_proxy must be a boolean' });
  const data = pick(req.body);
  if (!data.name?.trim()) return res.status(400).json({ error: 'Укажите название агента' });
  if (!data.acp_command?.trim()) return res.status(400).json({ error: 'Укажите команду ACP-адаптера' });
  try { res.status(201).json(createAgent(data as AgentInput)); }
  catch (e) { res.status(400).json({ error: /UNIQUE/.test(String(e)) ? 'Агент с таким названием уже есть' : String(e) }); }
});

agentsRouterRoutes.json('PATCH /api/agents/:id', async (req, res) => {
  if (req.body?.use_proxy !== undefined && typeof req.body.use_proxy !== 'boolean') return res.status(400).json({ error: 'use_proxy must be a boolean' });
  let release: (() => void) | undefined;
  try {
    if (req.body?.use_proxy !== undefined && getAgent(req.params.id)?.use_proxy !== req.body.use_proxy)
      release = await prepareAgentProxyChange(req.params.id);
    const a = updateAgent(req.params.id, pick(req.body));
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json(a);
  } catch (error) {
    res.status(409).json({ error: (error as Error).message });
  } finally {
    release?.();
  }
});

agentsRouterRoutes.json('POST /api/agents/:id/update', async (req, res) => {
  try {
    res.json(await updateAgentCli(req.params.id));
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Не удалось обновить агента' });
  }
});

agentsRouterRoutes.empty('DELETE /api/agents/:id', async (req, res) => {
  try {
    const ok = await deleteAgent(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (error: unknown) {
    if (error instanceof DomainError) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Не удалось удалить агента' });
  }
});
