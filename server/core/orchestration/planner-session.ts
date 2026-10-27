import { createSession } from '../agent-sessions/sessions';
import type { AgentSession } from '../agent-sessions/types';

/** Shared by ordinary planning runs and delivery of plan review cards. */
export function createPlannerSession(data: Omit<Parameters<typeof createSession>[0], 'role' | 'policy'> & { role?: AgentSession['role']; policy?: AgentSession['policy'] }): AgentSession {
  return createSession({ ...data, role: 'planner', policy: 'read-only' });
}
