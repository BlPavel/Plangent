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
  viewed: 'none' | 'viewed' | 'changed'
}
export interface ReviewCommit { sha: string; subject: string; author: string; date: string }
export interface BranchReview {
  review: { id: string; project_id: string; branch: string; base: string; branch_name: string; base_name: string; head: string; merge_base: string }
  files: ReviewFile[]
  commits: ReviewCommit[]
  commit_count: number
  new_commits: number
  rewritten: boolean
}
export interface ReviewThread { id: string; review_id: string; head: string; path: string; side: string; line: number; session_id: string }
export interface BranchQuestion { id: string; review_id: string; path: string; side: 'old' | 'new'; line: number; closed: boolean; created_at: string }
export interface BranchQuestionMessage { id: string; question_id: string; author: 'developer' | 'agent'; kind: string; text: string; sent: boolean; created_at: string }
export interface BranchQuestions { questions: BranchQuestion[]; messages: BranchQuestionMessage[] }
