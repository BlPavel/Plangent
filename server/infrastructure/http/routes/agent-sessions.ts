import { Router } from 'express';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import { createSession, listSessions, getSession, updateSession, deleteSession, history, findings } from '../../../core/agent-sessions/sessions';
import { startSession, sendPrompt, cancelSession, closeSession, answerPermission, setModel, setMode, setConfig, snapshot } from '../../../core/agent-sessions/acp-host';
import { editQueued } from '../../../core/agent-sessions/prompt-queue';
import { getProject } from '../../../core/projects';
import { getAgent } from '../../../core/agents';
import { broadcast } from '../../../core/shared/events';

export const agentSessionsRouter = Router();
agentSessionsRouter.get('/', (req, res) => res.json(listSessions(typeof req.query.projectId === 'string' ? req.query.projectId : undefined)));
agentSessionsRouter.post('/', async (req, res) => {
  try {
    const { project_id, agent_id, model, mode, config } = req.body;
    const policy = ['ask', 'allow-edits', 'allow-all', 'read-only'].includes(req.body.policy) ? req.body.policy : 'ask';
    if (!getProject(project_id) || !getAgent(agent_id)) return res.status(400).json({ error: 'Проект или агент не найден' });
    const session = createSession({ project_id, agent_id, model, role: 'chat', policy, metadata: { ...(typeof mode === 'string' && mode ? { preferredMode: mode } : {}), ...(config && typeof config === 'object' ? { preferredConfig: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, String(v)])) } : {}) } });
    res.status(201).json(session);
    void startSession(session.id).catch(() => {});
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouter.get('/:id', (req, res) => {
  try { res.json({ ...snapshot(req.params.id), events: history(req.params.id) }); }
  catch (e) { res.status(404).json({ error: String(e) }); }
});
agentSessionsRouter.get('/:id/findings', (req, res) => {
  try { res.json(findings(req.params.id)); }
  catch (e) { res.status(404).json({ error: String(e) }); }
});
agentSessionsRouter.post('/:id/:action', async (req, res) => {
  try {
    const id = req.params.id;
    const session = getSession(id);
    switch (req.params.action) {
      case 'prompt': {
        const content: ContentBlock[] = req.body.content ?? [{ type: 'text', text: req.body.text }];
        if (!Array.isArray(content) || !content.length || JSON.stringify(content).length > 20_000_000 ||
            content.some(c => !c || !['text', 'image', 'resource', 'resource_link'].includes(c.type))) throw new Error('Некорректное сообщение');
        await sendPrompt(id, content); break;
      }
      case 'cancel': await cancelSession(id); break;
      case 'close': await closeSession(id); updateSession(id, { status: 'ready', reason: '' }); break;
      case 'retry': await closeSession(id); await startSession(id); break;
      case 'permission': answerPermission(id, req.body.permissionId, req.body.optionId); break;
      case 'model': await setModel(id, req.body.model); break;
      case 'mode': await setMode(id, String(req.body.mode)); break;
      case 'config': await setConfig(id, String(req.body.configId), String(req.body.value)); break;
      case 'context': {
        const next = createSession({ project_id: session.project_id, agent_id: session.agent_id, role: 'chat', policy: 'ask' });
        const context = history(id).filter(e => ['user', 'assistant'].includes(e.type)).map(e => `${e.type}: ${e.payload.text ?? ''}`).join('\n').slice(-60_000);
        await sendPrompt(next.id, [{ type: 'text', text: `Контекст предыдущего разговора (может быть обрезан):\n${context}\nПродолжим разговор.` }]);
        return res.json(getSession(next.id));
      }
      default: return res.status(404).json({ error: 'Неизвестное действие' });
    }
    res.json(snapshot(id));
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouter.delete('/:id', async (req, res) => {
  try {
    getSession(req.params.id);
    await closeSession(req.params.id).catch(() => {});
    deleteSession(req.params.id);
    res.status(204).end();
  } catch (e) { res.status(404).json({ error: String(e) }); }
});
agentSessionsRouter.patch('/:id', async (req, res) => {
  try {
    const { title, policy } = req.body;
    if (policy && !['ask', 'allow-edits', 'allow-all', 'read-only'].includes(policy)) throw new Error('Неизвестная политика');
    const session = getSession(req.params.id);
    if (session.policy === 'read-only' && session.role !== 'chat' && policy !== 'read-only') throw new Error('Сначала запустите выполнение шага');
    res.json(updateSession(req.params.id, { ...(typeof title === 'string' ? { title: title.slice(0, 120) } : {}), ...(policy ? { policy } : {}) }));
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouter.patch('/:id/queue/:promptId', (req, res) => {
  try {
    getSession(req.params.id);
    if (typeof req.body.text !== 'string' || !req.body.text.trim()) throw new Error('Пустое сообщение');
    editQueued(req.params.id, req.params.promptId, JSON.stringify([{ type: 'text', text: req.body.text }]));
    broadcast({ type: 'agent_queue', sessionId: req.params.id }); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouter.delete('/:id/queue/:promptId', (req, res) => {
  editQueued(req.params.id, req.params.promptId); broadcast({ type: 'agent_queue', sessionId: req.params.id }); res.status(204).end();
});
