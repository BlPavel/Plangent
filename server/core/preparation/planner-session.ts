import { createAgentSession } from '../agents';
import type { AgentSession } from '../agents';

/** Shared by ordinary planning runs and delivery of plan review cards. */
export function createPlannerSession(data: Omit<Parameters<typeof createAgentSession>[0], 'role' | 'policy'> & { role?: AgentSession['role']; policy?: AgentSession['policy'] }): AgentSession {
  return createAgentSession({ ...data, role: 'planner', policy: 'read-only' });
}
