import { agentPreferences } from '../../../core/agents';
import { typedRoutes } from '../typed-route';
import { Router } from 'express';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import { createAgentSession, listSessions, getSession, updateSession, deleteSession, history, findings } from '../../../core/agents';
import { runAgentWork, cancelSession, closeSession, answerPermission, setModel, setMode, setConfig, switchAgent, snapshot } from '../../../core/agents';
import { editQueued } from '../../../core/agents/sessions/prompt-queue';
import { getProject } from '../../../core/projects';
import { getAgent } from '../../../core/agents/catalog';
import { getTask } from '../../../core/tasks';
import { rootForWorkspace } from '../../../core/workspaces/roots';
import { broadcast } from '../../../core/shared/events';

export const agentSessionsRouter = Router();
const agentSessionsRouterRoutes = typedRoutes(agentSessionsRouter, '/api/agent-sessions');
agentSessionsRouterRoutes.json('GET /api/agent-sessions', (req, res) => res.json(listSessions(typeof req.query.projectId === 'string' ? req.query.projectId : undefined)));
agentSessionsRouterRoutes.json('POST /api/agent-sessions', async (req, res) => {
  try {
    const { project_id, agent_id, model, mode, config } = req.body;
    const role = req.body.role ?? 'chat';
    const libraryScope = req.body.library_scope;
    const librarySection = req.body.library_section;
    if (librarySection !== undefined && (role !== 'librarian' || typeof librarySection !== 'string' || !librarySection.trim() || librarySection.length > 100)) return res.status(400).json({ error: 'Invalid library section' });
    if (libraryScope !== undefined && (role !== 'librarian' || !['global', 'project'].includes(libraryScope))) return res.status(400).json({ error: 'Invalid library scope' });
    if (role !== 'chat' && role !== 'librarian' && role !== 'code-fixer') return res.status(400).json({ error: 'Invalid session role' });
    if (role === 'code-fixer' && getProject(project_id)?.kind !== 'project') return res.status(400).json({ error: 'Choose a project for the code fixer' });
    if (role === 'librarian' && getProject(project_id)?.kind === 'source') return res.status(400).json({ error: 'Choose a project or group for the librarian' });
    const workspaceId = req.body.workspace_id ?? req.body.workspace;
    if (workspaceId !== undefined) rootForWorkspace(project_id, workspaceId);
    const policy = role === 'librarian' ? 'read-only' : ['ask', 'allow-edits', 'allow-all', 'read-only'].includes(req.body.policy ?? '') ? req.body.policy! : 'ask';
    if (!getProject(project_id) || !getAgent(agent_id)) return res.status(400).json({ error: 'Проект или агент не найден' });
    // No pick (the agent's options were not loaded yet) → the default from the agent's settings.
    const session = createAgentSession({ project_id, agent_id, model: model || getAgent(agent_id)!.model, role, policy, metadata: { ...(workspaceId ? { workspace_id: workspaceId } : {}), ...(libraryScope ? { library_scope: libraryScope } : {}), ...(librarySection ? { library_section: librarySection } : {}), ...agentPreferences(mode, config) } });
    res.status(201).json(session);
    void runAgentWork(session.id).catch(() => {});
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouterRoutes.json('GET /api/agent-sessions/:id', (req, res) => {
  try { res.json({ ...snapshot(req.params.id), events: history(req.params.id) }); }
  catch (e) { res.status(404).json({ error: String(e) }); }
});
agentSessionsRouterRoutes.json('GET /api/agent-sessions/:id/findings', (req, res) => {
  try { res.json(findings(req.params.id)); }
  catch (e) { res.status(404).json({ error: String(e) }); }
});
agentSessionsRouterRoutes.json('POST /api/agent-sessions/:id/:action', async (req, res) => {
  try {
    const id = req.params.id;
    const session = getSession(id);
    if (session.task_id && getTask(session.task_id)?.status === 'done' && !['cancel', 'close'].includes(req.params.action))
      return res.status(409).json({ error: 'Завершённая задача доступна только для чтения' });
    switch (req.params.action) {
      case 'prompt': {
        const content: ContentBlock[] = req.body.content ?? [{ type: 'text', text: req.body.text ?? '' }];
        if (!Array.isArray(content) || !content.length || JSON.stringify(content).length > 20_000_000 ||
            content.some(c => !c || !['text', 'image', 'resource', 'resource_link'].includes(c.type))) throw new Error('Некорректное сообщение');
        if (req.body.gitForTurn === true && (!['chat', 'task-chat', 'errand'].includes(session.role) || getProject(session.project_id)?.kind !== 'project')) throw new Error('Git permission is unavailable for this session');
        await runAgentWork(id, content, req.body.gitForTurn === true); break;
      }
      case 'cancel': await cancelSession(id); break;
      case 'close': await closeSession(id); updateSession(id, { status: 'ready', reason: '' }); break;
      case 'retry': await closeSession(id); await runAgentWork(id); break;
      case 'permission': answerPermission(id, req.body.permissionId ?? '', req.body.optionId ?? ''); break;
      case 'agent':
        if (session.role !== 'errand' || typeof req.body.agent_id !== 'string') throw new Error('Агента можно сменить только в чате поручения');
        await switchAgent(id, req.body.agent_id); break;
      case 'model': await setModel(id, req.body.model ?? ''); break;
      case 'mode': await setMode(id, String(req.body.mode)); break;
      case 'config': await setConfig(id, String(req.body.configId), String(req.body.value)); break;
      case 'context': {
        if (session.metadata.mr_private) throw new Error('Continue the private thread in the Review tab');
        const next = createAgentSession({ project_id: session.project_id, agent_id: session.agent_id, role: session.role === 'code-fixer' ? 'code-fixer' : session.role === 'librarian' ? 'librarian' : 'chat', policy: session.role === 'librarian' ? 'read-only' : 'ask', metadata: session.role === 'librarian' ? { library_scope: session.metadata.library_scope ?? 'project', ...(typeof session.metadata.library_section === 'string' ? { library_section: session.metadata.library_section } : {}) } : {} });
        const context = history(id).filter(e => ['user', 'assistant'].includes(e.type)).map(e => `${e.type}: ${e.payload.text ?? ''}`).join('\n').slice(-60_000);
        await runAgentWork(next.id, [{ type: 'text', text: `Контекст предыдущего разговора (может быть обрезан):\n${context}\nПродолжим разговор.` }]);
        return res.json(getSession(next.id));
      }
      default: return res.status(404).json({ error: 'Неизвестное действие' });
    }
    res.json(snapshot(id));
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouterRoutes.empty('DELETE /api/agent-sessions/:id', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    await closeSession(req.params.id).catch(() => {});
    deleteSession(req.params.id);
    res.status(204).end();
  } catch (e) { res.status(404).json({ error: String(e) }); }
});
agentSessionsRouterRoutes.json('PATCH /api/agent-sessions/:id', async (req, res) => {
  try {
    const { title, policy } = req.body;
    if (policy && !['ask', 'allow-edits', 'allow-all', 'read-only'].includes(policy)) throw new Error('Неизвестная политика');
    const session = getSession(req.params.id);
    if (session.policy === 'read-only' && session.role !== 'chat' && policy !== 'read-only') throw new Error('Сначала запустите выполнение шага');
    res.json(updateSession(req.params.id, { ...(typeof title === 'string' ? { title: title.slice(0, 120), metadata: { ...session.metadata, titleSource: 'manual' } } : {}), ...(policy ? { policy } : {}) }));
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouterRoutes.json('PATCH /api/agent-sessions/:id/queue/:promptId', (req, res) => {
  try {
    getSession(req.params.id);
    if (typeof req.body.text !== 'string' || !req.body.text.trim()) throw new Error('Пустое сообщение');
    editQueued(req.params.id, req.params.promptId, JSON.stringify([{ type: 'text', text: req.body.text }]));
    broadcast({ type: 'agent_queue', sessionId: req.params.id }); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});
agentSessionsRouterRoutes.empty('DELETE /api/agent-sessions/:id/queue/:promptId', (req, res) => {
  editQueued(req.params.id, req.params.promptId); broadcast({ type: 'agent_queue', sessionId: req.params.id }); res.status(204).end();
});
