export type PermissionPolicy = 'ask' | 'allow-edits' | 'allow-all' | 'read-only';
export type SessionStatus = 'starting' | 'thinking' | 'waiting' | 'ready' | 'complete' | 'error';
export interface AgentSession {
  id: string;
  project_id: string;
  task_id: string | null;
  run_id: string | null;
  step_ids: string[];
  role: 'chat' | 'planner' | 'executor' | 'reviewer';
  agent_id: string;
  model: string;
  acp_session_id: string | null;
  title: string;
  status: SessionStatus;
  reason: string;
  policy: PermissionPolicy;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export interface SessionEvent {
  session_id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}
