export interface LayoutSlot {
  dir: string;
  global: string;
  file: string;
  asSkill?: boolean;
  asMerged?: boolean;
}

export interface LayoutProfile {
  skills?: LayoutSlot;
  commands?: LayoutSlot;
  main?: { file: string; global: string };
}

export interface Agent {
  id: string;
  name: string;
  // ACP adapter process; empty for the seeded agents, which fall back to their preset (core/agents/presets).
  acp_command: string;
  acp_args: string[];
  env: Record<string, string>;
  // Plain CLI: used to read usage limits; update_command updates it.
  command: string;
  update_command: string;
  // Where the library syncer writes instructions/skills for this agent.
  layout_profile: LayoutProfile | null;
  // Defaults for new sessions, as values the agent itself reported (see agents/acp-options).
  model: string;
  reasoning_effort: string;
  active: boolean;
  created_at: string;
}

export interface ProjectConfig {
  dangerous_commands?: string[];
  extra_env?: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  repo_path: string;
  default_agent_id: string | null;
  config: ProjectConfig;
  hide_from_git: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  key: string;
  title?: string;
  description?: string;
  jira_url?: string;
  branch_name?: string;
  status: 'open' | 'in_progress' | 'done';
  created_at: string;
}

export interface Plan {
  id: string;
  task_id: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PlanStep {
  text: string;
  done: boolean;
  index: number;
  id?: string;            // stable (pN) id
  parallelGroup?: string; // @parallel:<groupName>
}

export interface PlanFrontmatter {
  plangent?: number;
  key?: string;
  title?: string;
  status?: 'open' | 'in_progress' | 'done';
}

// Orchestrator types
type OrchestratorSessionStatus =
  | 'queued'
  | 'reviewing'
  | 'ready_for_execution'
  | 'running'
  | 'waiting_for_developer'
  | 'complete'
  | 'failed';

export type QueueSessionMode = 'execute' | 'review_first';
// How the executor's permission requests are answered (see agent-sessions/permissions.ts);
// dangerous commands always go to the developer.
export type ExecutionPolicy = 'allow-all' | 'allow-edits' | 'ask';

export interface OrchestratorQueueSession {
  id: string;
  points: string[];           // point ids (pN)
  agentId: string;
  parallelGroup: string | null;
  queueMode: QueueSessionMode;
  permissionPolicy: ExecutionPolicy;
  status: OrchestratorSessionStatus;
  // When true the orchestrator pauses after this session's step completes,
  // so the developer can review before the next step starts.
  pauseAfter?: boolean;
  reviewerId?: string;
  reviewSessionId?: string;
  reviewRound?: number;
  maxReviewRounds?: number;
  reason?: string;
  // Per-run override of the agent's configured model/reasoning_effort
  // (see Agent.model / Agent.reasoning_effort) — leave unset to use the agent's default.
  model?: string;
  reasoningEffort?: string;
  runId?: string;
  sessionId?: string;
  mode?: 'acp';
}

type OrchestratorStatus = 'running' | 'paused' | 'waiting_for_developer' | 'finished' | 'failed';

export interface OrchestratorState {
  id: string;
  taskId: string;
  projectId: string;
  sessions: OrchestratorQueueSession[];
  status: OrchestratorStatus;
  startedAt: string;
}

export interface Run {
  id: string;
  task_id: string;
  plan_id?: string;
  agent_id?: string;
  agent_name: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  completed_steps: string[];
  notes?: string;
  started_at: string;
  finished_at?: string;
}

export type LibraryItemType = 'skill' | 'command' | 'main' | 'plan-template';
export type LibraryScope = 'global' | 'project';

export interface LibraryItem {
  id: string;
  type: LibraryItemType;
  slug: string;
  title: string;
  description: string;
  scope: LibraryScope;
  project_id: string | null;
  frontmatter: Record<string, unknown>;
  agent_filter: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
