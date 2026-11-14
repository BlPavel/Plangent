import type { AgentSession } from '../../../models';

export const COMPLETED_WORK_IDLE_MS = 60_000;
export const CHAT_IDLE_MS = 5 * 60_000;
const shortLivedRoles = new Set<AgentSession['role']>(['executor', 'task-reviewer', 'plan-reviewer']);

export function idleTimeout(session: Pick<AgentSession, 'role' | 'metadata'>): number {
  return shortLivedRoles.has(session.role) && typeof session.metadata.workFinishedAt === 'number'
    ? COMPLETED_WORK_IDLE_MS : CHAT_IDLE_MS;
}

export function idleDeadline(session: Pick<AgentSession, 'role' | 'metadata'>, idleSince: number): number {
  const finished = typeof session.metadata.workFinishedAt === 'number' ? session.metadata.workFinishedAt : 0;
  return Math.max(idleSince, finished) + idleTimeout(session);
}
