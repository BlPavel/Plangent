import type { CodeReview, CodeReviewItem, CodeReviewMessage, CodeReviewRound, CodeReviewFileView, CreateCodeReviewItem } from '../../../../server/models/code-review'
export type { CodeReview, CodeReviewItem, CodeReviewMessage, CodeReviewRound, CodeReviewFileView }
export interface RepositoryInfo { branch: string | null; head: string | null; message: string | null; detached: boolean }
export interface GitChange { path: string; originalPath?: string; status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'; indexStatus: string; worktreeStatus: string }
export interface TreeEntry { name: string; path: string; directory: boolean; ignored: boolean; status?: GitChange['status']; changes: number }
export interface LineStat { added: number; deleted: number; binary?: boolean }
export interface CodeFile { path: string; size: number; kind: 'text' | 'image' | 'binary' | 'too-large'; content?: string; mime?: string }
export interface DiffOptions { base?: string; end?: string; originalPath?: string; ignoreWhitespace?: boolean }
export interface SearchOptions { query: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; mask?: string }
export type SearchEvent = { type: 'match'; path: string; line: number; text: string } | { type: 'done'; matches: number; files: number; truncated: boolean }
export type ReviewDraft = { comparison_ref?: string } & Omit<CreateCodeReviewItem, 'review_id' | 'round_id' | 'author' | 'status' | 'answer' | 'carried_from_item_id' | 'outdated' | 'closed'>
export type DraftPatch = Partial<Pick<CodeReviewItem, 'scope' | 'file' | 'line_start' | 'line_end' | 'side' | 'kind' | 'text' | 'refs' | 'code_snippet'>>
export interface ReviewAttention { project_id: string; review_id: string; origin: 'project' | 'task'; origin_id: string; count: number; items: CodeReviewItem[] }
export interface ReviewDetail {
  review: CodeReview; read_only: boolean; items: CodeReviewItem[]; messages: CodeReviewMessage[]; rounds: CodeReviewRound[]; file_views: CodeReviewFileView[]
  chats: { session_id: string | null; events: { seq: number; type: string; payload: unknown; created_at: string }[] }[]
}
export interface CurrentReview {
  repository: RepositoryInfo | null; review: CodeReview | null; items: CodeReviewItem[]; messages: CodeReviewMessage[]; rounds: CodeReviewRound[]
  summary: { head_start: string; head_current: string | null; commits: number | null; rounds: number; items: number; unresolved: number } | null
  file_views: (CodeReviewFileView & { current_hash: string | null; viewed: boolean; changed_after_view: boolean })[]
  other_reviews: CodeReview[]; running_other_reviews: CodeReview[]; agent_working: boolean; attention: number; head_changed: boolean
}
/** A comparison other than «against HEAD»: both ends are accepted by the per-file diff (`base`/`end`). */
export interface BaseChanges { base: string; end: string; changes: GitChange[]; stats: Record<string, LineStat> }
export type ReviewHistory = CodeReview & { read_only: boolean; commits: number | null; rounds: number; items: number; resolved: number; unresolved: number }

/** A colleague's discussion on the current branch's merge request (not a thread with the agent). */
export interface ExternalNote { id: number; author: string; body: string; mine: boolean }
export interface ExternalThread { id: string; resolved: boolean; path: string | null; line: number | null; side: 'new' | 'old'; notes: ExternalNote[] }
/** Where a GitLab thread card sends its actions: the Код tab's own MR by default, or another MR (the Ревью tab). */
export interface ExternalThreadActions {
  reply(discussion: string, body: string): Promise<unknown>
  resolve(discussion: string, resolved: boolean): Promise<unknown>
  editNote(discussion: string, note: number, body: string): Promise<unknown>
  deleteNote(discussion: string, note: number): Promise<unknown>
}
export interface ExternalThreads { mr: { iid: number; title: string; url: string; state: string } | null; threads: ExternalThread[] }
