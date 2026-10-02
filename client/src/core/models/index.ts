export interface LayoutSlot {
  dir: string
  global: string
  file: string
  asSkill?: boolean
  asMerged?: boolean
}

export interface LayoutProfile {
  skills?: LayoutSlot
  commands?: LayoutSlot
  main?: { file: string; global: string }
}

export interface Agent {
  id: string
  name: string
  acp_command: string
  acp_args: string[]
  env: Record<string, string>
  command: string
  update_command: string
  layout_profile: LayoutProfile | null
  model: string
  reasoning_effort: string
  active: boolean
  created_at: string
}

export interface AgentPreset {
  name: string
  acp_command: string
  acp_args: string[]
  command: string
  update_command: string
  layout_profile: LayoutProfile | null
}

// group: holds projects and its own tasks. source (справочник): a read-only folder referenced as @key.
export type ProjectKind = 'project' | 'group' | 'source'

export interface Project {
  id: string
  kind: ProjectKind
  name: string
  // @-key of projects and sources (unique across both); null for groups.
  key: string | null
  repo_path: string
  group_id: string | null
  icon: string
  // What the agent is told about it.
  description: string
  default_agent_id: string | null
  config: { extra_env?: Record<string, string>; dangerous_commands?: string[]; available_everywhere?: boolean }
  hide_from_git?: boolean
  created_at: string
  // Sources: groups/projects it is shared with (unless available_everywhere).
  targets?: string[]
  source_type?: 'folder' | 'docs'
  connection_id?: string | null
  docs_config?: Record<string, unknown>
  docs_selection?: { id: string; include_descendants: boolean; excluded_ids?: string[] }[]
  sync_status?: 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  last_sync_at?: string | null
  sync_stats?: { message?: string; code?: string; confirmation_count?: number; warnings?: string[]; errors?: number; found?: number; downloaded?: number; added?: number; updated?: number; deleted?: number }
  // Open tasks, as listed by GET /projects.
  active_tasks?: number
}

export interface Task {
  id: string
  project_id: string
  key: string
  title?: string
  description?: string
  jira_url?: string
  branch_name?: string
  status: 'open' | 'in_progress' | 'done'
  created_at: string
}

export interface AnalysisFile { id: string; section_id: string; name: string; mime: string; size: number; created_at: string }
export interface AnalysisSection { id: string; task_id: string; slug: string; title: string; description: string; kind: 'source' | 'worked'; author: 'developer' | 'agent'; position: number; created_at: string; updated_at: string; files: AnalysisFile[] }

export interface PlanStep {
  text: string
  done: boolean
  index: number
  id?: string
  parallelGroup?: string
}

export interface Plan {
  id: string
  task_id: string
  content: string
  version: number
  steps: PlanStep[]
  created_at: string
  updated_at: string
}

export interface Run {
  id: string
  task_id: string
  agent_id?: string
  agent_name: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  completed_steps: string[]
  notes?: string
  started_at: string
  finished_at?: string
}

export type LibraryItemType = 'skill' | 'command' | 'main' | 'plan-template' | 'instruction-guide'
export type LibraryScope = 'global' | 'project'

export interface LibraryItem {
  id: string
  type: LibraryItemType
  slug: string
  title: string
  description: string
  // global: everywhere; project: only `targets` (groups/projects; a group covers its projects).
  scope: LibraryScope
  targets: string[]
  // Groups from `targets` that give the item to their own folder only, not their projects.
  own_only: string[]
  // For a project's own copy of a group's item: the item it was detached from.
  detached_from?: string | null
  // How the item reaches the project it was listed for (GET /library?forProject=).
  origin?: 'global' | 'group' | 'direct'
  frontmatter: Record<string, unknown>
  agent_filter: string[]
  enabled: boolean
  content?: string
  created_at: string
  updated_at: string
}

/** A library change the librarian agent proposed; the developer applies or rejects it. */
export type LibraryProposalStatus = 'pending' | 'applied' | 'rejected' | 'stale'
export interface LibraryProposal {
  id: string
  project_id: string
  session_id: string
  status: LibraryProposalStatus
  action: 'create' | 'update'
  type: 'skill' | 'main' | 'command'
  slug: string
  title: string
  description: string
  frontmatter: Record<string, unknown>
  content: string
  scope: LibraryScope
  targets: string[]
  own_only: string[]
  explanation: string
  item_id: string | null
  // The item as it was when proposed: the base of the diff and of the staleness check.
  snapshot: (LibraryItem & { content: string }) | null
  applied_item_id: string | null
  created_at: string
  updated_at: string
}

export interface RunStartResult {
  run: Run
  session_id: string
  mode: 'acp'
  prompt: string
}

// Orchestrator types
export type OrchestratorSessionStatus =
  | 'queued'
  | 'reviewing'
  | 'ready_for_execution'
  | 'running'
  | 'waiting_for_developer'
  | 'complete'
  | 'failed'
  // the queue was stopped mid-session; a relaunch runs it again for its undone points
  | 'stopped'

export type QueueSessionMode = 'execute' | 'review_first'
export type ExecutionPolicy = 'allow-all' | 'allow-edits' | 'ask'

export interface OrchestratorQueueSession {
  reviewerId?: string
  reviewSessionId?: string
  reviewRound?: number
  maxReviewRounds?: number
  reason?: string
  id: string
  points: string[]
  agentId: string
  queueMode: QueueSessionMode
  permissionPolicy: ExecutionPolicy
  status: OrchestratorSessionStatus
  runId?: string
  sessionId?: string
  mode?: 'acp'
  model?: string
  reasoningEffort?: string
}

// Sessions of a stage run in parallel; stages run one after another.
export interface QueueStage {
  id: string
  sessions: OrchestratorQueueSession[]
  pauseAfter: boolean
}

// Stages of an earlier run, moved out of the queue once all their sessions were done.
export interface QueueRun {
  id: string
  finishedAt: string
  stages: QueueStage[]
}

// idle/stopped/finished/failed: editable. running/paused: frozen until stopped.
export type QueueStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'finished' | 'failed'

export interface TaskQueue {
  taskId: string
  projectId: string
  status: QueueStatus
  stages: QueueStage[]
  stageIndex: number
  pauseRequested: boolean
  reason?: string
  // earlier runs, newest first
  history?: QueueRun[]
  updatedAt: string
}

// Orchestrator WS events. Queue notifications carry projectId/taskKey so they can be shown for any task.
interface QueueEventBase { taskId: string; projectId?: string; taskKey?: string }
export type OrchestratorEvent = QueueEventBase & (
  | { type: 'queue_updated'; queue: TaskQueue }
  | { type: 'review_started'; sessionId: string; reviewSessionId: string }
  | { type: 'session_started'; sessionId: string; runId: string; terminalSessionId: string; mode: 'acp'; points: string[] }
  | { type: 'session_ready_for_execution'; sessionId: string; message: string }
  | { type: 'session_complete'; sessionId: string; runId?: string }
  | { type: 'session_waiting'; sessionId: string; message: string }
  | { type: 'session_failed'; sessionId: string; reason: string }
  | { type: 'queue_finished'; failed: number }
  | { type: 'queue_paused'; stageIndex: number }
  | { type: 'run_failed'; reason: string }
  | { type: 'analysis_updated'; actor: 'developer' | 'agent' }
  | { type: 'task_status'; status: Task['status'] }
  // idMap: old → new step ids when the planner's plan was renumbered in order.
  | { type: 'plan_updated'; content?: string; steps: PlanStep[]; idMap?: Record<string, string> }
)
