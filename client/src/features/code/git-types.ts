import type { RepositoryInfo } from './types'
/** A merge/rebase/cherry-pick/revert the developer started and has not finished. */
export interface GitOperationState {
  kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert'; id: string; branch: string | null
  commit: { sha: string; subject: string; name: string | null } | null
  onto: { sha: string; name: string | null } | null
  step: { done: number; total: number } | null
}
export interface GitTracking extends RepositoryInfo { upstream: string | null; ahead: number; behind: number; origin: string | null; busyReason: string; operation: GitOperationState | null }
export interface ConflictFile {
  path: string; code: string; conflicted: boolean
  note: { outcome: 'resolved' | 'question' | 'recommend'; text: string; answer: string; answer_sent: boolean } | null
}
export interface ConflictState {
  operation: GitOperationState | null; files: ConflictFile[]
  session: { id: string; status: string; reason: string } | null
}
export interface GitBranch { name: string; ref: string; remote: boolean }
export interface Coauthor { name: string; email: string }
export interface CommitInput { title: string; body: string; includeDescription: boolean; includeCoauthors: boolean; coauthors: Coauthor[] }
export interface MessageCheck { cleanedCoauthors?: Coauthor[]; message: string; cleaned: string; violations: { kind: 'forbidden' | 'format'; line: number; text: string; pattern: string }[] }
export interface GitPreferences {
  include_description: boolean; branch_prefixes: string[]; base_branch: string; finish_scenario: 'nothing' | 'commits' | 'push' | 'full'
  mr_reviewers: string[]; mr_assignees: string[]; mr_squash: boolean; mr_remove_branch: boolean; git_agent_id: string; git_agent_model: string; git_agent_effort: string
  /** The agent that actually does the git work (configured, else the project's); null — none chosen. */
  agent: { agentId: string; model: string; effort: string } | null
}
