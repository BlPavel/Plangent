import * as repository from '../../../infrastructure/db/repositories/agents/sessions';
import { broadcast } from '../../shared';
import type { AgentSession, SessionEvent } from './types';
export { initSessions, getSession, listSessions, history, toolCallPayload, findings } from '../../../infrastructure/db/repositories/agents/sessions';
export type { ReviewFinding } from '../../../infrastructure/db/repositories/agents/sessions';
import { getSession } from '../../../infrastructure/db/repositories/agents/sessions';
import { getAgent } from '../catalog';
export function createSession(data: Parameters<typeof repository.createSession>[0]): AgentSession {
  if (!getAgent(data.agent_id)) throw new Error('Агент удалён или не найден. Выберите другого агента.');
  if (['librarian', 'committer', 'plan-reviewer', 'task-reviewer'].includes(data.role)) data = { ...data, policy: 'read-only' };
  const session = repository.createSession(data);
  broadcast({ type: 'agent_session', session });
  return session;
}
export function updateSession(id: string, data: Partial<AgentSession>): AgentSession {
  if (data.policy && data.policy !== 'read-only' && (['librarian', 'committer', 'plan-reviewer', 'task-reviewer'].includes(getSession(id).role) || getSession(id).metadata.mr_private)) throw new Error('Librarian sessions are read-only');
  const session = repository.updateSession(id, data);
  broadcast({ type: 'agent_session', session });
  return session;
}
export function updateAgentTitle(id: string, title: string | null | undefined): void {
  if (typeof title !== 'string') return;
  const normalized = title.replace(/\s+/g, ' ').trim().slice(0, 120);
  // Some adapters first echo the hidden repository instruction as a provisional title.
  if (!normalized || /^do not commit\b/i.test(normalized)) return;
  const session = getSession(id);
  if (session.role !== 'chat' || session.task_id || session.metadata.mr_private
      || session.metadata.titleSource === 'manual' || session.metadata.titleSource === 'custom'
      || session.title === normalized) return;
  updateSession(id, { title: normalized, metadata: { ...session.metadata, titleSource: 'agent' } });
}
export function addEvent(id: string, type: string, payload: Record<string, unknown>): SessionEvent {
  const event = repository.addEvent(id, type, payload);
  broadcast({ type: 'agent_event', event });
  return event;
}
export function deleteSession(id: string): void {
  const session = repository.listSessions().find(s => s.id === id);
  repository.deleteSession(id);
  broadcast({ type: 'agent_session_deleted', sessionId: id, taskId: session?.task_id, projectId: session?.project_id });
}
