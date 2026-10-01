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
  analysisLinks?: string[];
  parallelGroup?: string; // @parallel:<groupName>
}

export interface PlanFrontmatter {
  plangent?: number;
  key?: string;
  title?: string;
  status?: 'open' | 'in_progress' | 'done';
}

// Orchestrator types
// `stopped`: the developer stopped the queue mid-session; relaunching the queue runs it
// again for its points that are still not done in the plan.
export type OrchestratorSessionStatus =
  | 'queued'
  | 'reviewing'
  | 'ready_for_execution'
  | 'running'
  | 'waiting_for_developer'
  | 'complete'
  | 'failed'
  | 'stopped';

export type QueueSessionMode = 'execute' | 'review_first';
// How the executor's permission requests are answered (see agent-sessions/permissions.ts);
// dangerous commands always go to the developer.
export type ExecutionPolicy = 'allow-all' | 'allow-edits' | 'ask';

export interface OrchestratorQueueSession {
  id: string;
  points: string[];           // point ids (pN)
  agentId: string;
  queueMode: QueueSessionMode;
  permissionPolicy: ExecutionPolicy;
  status: OrchestratorSessionStatus;
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

// A stage runs its sessions in parallel; stages run one after another.
export interface QueueStage {
  id: string;
  sessions: OrchestratorQueueSession[];
  // Pause the queue once this stage is done, so the developer can review before the next one.
  pauseAfter: boolean;
}

// Stages of an earlier run, kept out of the way once all their sessions were done.
export interface QueueRun {
  id: string;
  finishedAt: string;
  stages: QueueStage[];
}

// idle: draft, editable. running/paused: frozen until stopped. stopped/finished/failed: editable again.
export type QueueStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'finished' | 'failed';

// The execution queue of a task, persisted in task_queues so it survives restarts.
export interface TaskQueue {
  taskId: string;
  projectId: string;
  status: QueueStatus;
  stages: QueueStage[];
  // Index of the stage being executed (running/paused only).
  stageIndex: number;
  // "Pause after the current stage" requested while running.
  pauseRequested: boolean;
  reason?: string;
  // Earlier runs, newest first (see archiveFinished).
  history?: QueueRun[];
  updatedAt: string;
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

export interface AnalysisSection {
  id: string;
  task_id: string;
  slug: string;
  title: string;
  description: string;
  kind: 'source' | 'worked';
  author: 'developer' | 'agent';
  position: number;
  created_at: string;
  updated_at: string;
}
export interface AnalysisFile {
  id: string;
  section_id: string;
  name: string;
  mime: string;
  size: number;
  content: Buffer;
  created_at: string;
}
