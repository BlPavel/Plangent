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

export interface Project {
  id: string
  name: string
  repo_path: string
  default_agent_id: string | null
  config: { extra_env?: Record<string, string>; dangerous_commands?: string[] }
  hide_from_git?: boolean
  created_at: string
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

export type LibraryItemType = 'skill' | 'command' | 'main' | 'plan-template'
export type LibraryScope = 'global' | 'project'

export interface LibraryItem {
  id: string
  type: LibraryItemType
  slug: string
  title: string
  description: string
  scope: LibraryScope
  project_id: string | null
  frontmatter: Record<string, unknown>
  agent_filter: string[]
  enabled: boolean
  content?: string
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
