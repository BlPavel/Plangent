import type { ExternalThread } from '@features/code'

export interface BranchRef { name: string; ref: string; remote: boolean }
export interface BranchList { branches: BranchRef[]; current: string | null; default_base: string | null }
export interface ReviewFile {
  path: string
  old_path?: string
  status: string
  added: number
  deleted: number
  binary: boolean
  sig: string
  /** Changed by the author after the developer's last publication. */
  changed_since: boolean
}
export interface ReviewCommit { sha: string; subject: string; author: string; date: string }
export interface BranchReview {
  review: {
    id: string; project_id: string; branch: string; base: string; branch_name: string; base_name: string; head: string; merge_base: string
    mr_iid: number | null; context: string; task_id: string | null; skill_id: string | null; overview: string; overview_head: string; published_head: string
    /** The agent's review: '' before it, running, done, stopped or failed. */
    analysis_status: '' | 'running' | 'done' | 'stopped' | 'failed'; analysis_session: string; analysis_note: string
  }
  files: ReviewFile[]
  commits: ReviewCommit[]
  commit_count: number
  new_commits: number
  rewritten: boolean
  /** Commits after the last publication. */
  round_commits: number
}
export interface ReviewThread { id: string; review_id: string; head: string; path: string; side: string; line: number; session_id: string }
export interface BranchQuestion { id: string; review_id: string; path: string; side: 'old' | 'new'; line: number; closed: boolean; created_at: string }
export interface BranchQuestionMessage { id: string; question_id: string; author: 'developer' | 'agent'; kind: string; text: string; sent: boolean; created_at: string }
export interface BranchQuestions { questions: BranchQuestion[]; messages: BranchQuestionMessage[] }

export interface Approvals { count: number; required: number | null; left: number | null; mine: boolean; names: string[] }
export interface MrListItem {
  project_id: string; project_name: string
  iid: number; title: string; web_url: string
  author: { name: string; username: string }
  source_branch: string; target_branch: string
  created_at: string; updated_at: string; notes: number
  /** I wrote it. */
  mine: boolean
  reviewer: boolean
  approvals: Approvals | null
  /** Unresolved threads and those of them I started; null when not loaded (MRs I have nothing to do with). */
  threads: { open: number; mine_open: number } | null
  /** The author pushed after I published my remarks. */
  after_review: boolean
  review_id: string | null
}
export interface MrList { items: MrListItem[]; errors: { project_id: string; project_name: string; message: string }[] }
export interface MrInfo {
  mr: { iid: number; title: string; description: string; web_url: string; state: string; author: { name: string; username: string }; source_branch: string; target_branch: string; head_sha: string }
  approvals: Approvals | null
  threads: ExternalThread[]
}
export interface Remark {
  id: string; review_id: string; path: string; side: 'old' | 'new'; line: number; head: string
  body: string; author: 'developer' | 'agent'
  remote_id: number | null; status: 'draft' | 'sent' | 'uncertain'; error: string; created_at: string
  /** The developer has changed the text (of an agent's draft too). */
  edited: boolean
  /** Attached to a line of an older version of the branch. */
  outdated: boolean
}
export interface Remarks { remarks: Remark[]; publication_error?: string }
export interface ReviewSkill { id: string; title: string; description: string; origin: 'direct' | 'group' | 'global' }
