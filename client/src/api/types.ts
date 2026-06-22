export interface Agent {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  skills_dir: string
  skills_filename: string
  active: boolean
  created_at: string
}

export interface Project {
  id: string
  name: string
  repo_path: string
  default_agent_id: string | null
  config: { extra_env?: Record<string, string> }
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

export type LibraryItemType = 'skill' | 'command' | 'main'
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
  mode: 'tmux' | 'pty'
  prompt: string
}

// Orchestrator types
export type OrchestratorSessionStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_developer'
  | 'complete'
  | 'failed'

export interface OrchestratorQueueSession {
  id: string
  points: string[]
  agentId: string
  parallelGroup: string | null
  status: OrchestratorSessionStatus
  runId?: string
  sessionId?: string
  mode?: 'tmux' | 'pty'
}

export type OrchestratorStatus = 'running' | 'waiting_for_developer' | 'finished' | 'failed'

export interface OrchestratorState {
  id: string
  taskId: string
  projectId: string
  sessions: OrchestratorQueueSession[]
  status: OrchestratorStatus
  startedAt: string
}

export interface OrchestratorResponse {
  active: boolean
  state?: OrchestratorState
}

export interface ExecuteResponse {
  orchestratorId: string
  sessions: Pick<OrchestratorQueueSession, 'id' | 'points' | 'agentId' | 'status'>[]
}

// Orchestrator WS events
export type OrchestratorEvent =
  | { type: 'session_started'; taskId: string; sessionId: string; runId: string; terminalSessionId: string; mode: 'tmux' | 'pty'; points: string[] }
  | { type: 'session_complete'; taskId: string; sessionId: string; runId?: string }
  | { type: 'session_waiting'; taskId: string; sessionId: string; runId: string; terminalSessionId?: string; message: string }
  | { type: 'session_failed'; taskId: string; sessionId: string; reason: string }
  | { type: 'session_no_signal'; taskId: string; sessionId: string; runId: string; message: string }
  | { type: 'queue_finished'; taskId: string }
  | { type: 'run_failed'; taskId: string; reason: string }
  | { type: 'task_status'; taskId: string; status: Task['status'] }
  | { type: 'plan_updated'; taskId: string; content?: string; steps: PlanStep[] }
