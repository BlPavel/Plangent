import type { RepositoryInfo } from './types'
export interface GitTracking extends RepositoryInfo { upstream: string | null; ahead: number; behind: number; origin: string | null; busyReason: string }
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
