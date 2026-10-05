import type { CodeReview, CodeReviewItem, CodeReviewRound, CodeReviewFileView, CreateCodeReviewItem } from '../../../../server/models/code-review'
export type { CodeReview, CodeReviewItem, CodeReviewRound, CodeReviewFileView }
export interface RepositoryInfo { branch: string | null; head: string | null; message: string | null; detached: boolean }
export interface GitChange { path: string; originalPath?: string; status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'; indexStatus: string; worktreeStatus: string }
export interface TreeEntry { name: string; path: string; directory: boolean; ignored: boolean; status?: GitChange['status']; changes: number }
export interface LineStat { added: number; deleted: number; binary?: boolean }
export interface CodeFile { path: string; size: number; kind: 'text' | 'image' | 'binary' | 'too-large'; content?: string; mime?: string }
export interface DiffOptions { base?: string; end?: string; originalPath?: string; ignoreWhitespace?: boolean }
export interface SearchOptions { query: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; mask?: string }
export type SearchEvent = { type: 'match'; path: string; line: number; text: string } | { type: 'done'; matches: number; files: number; truncated: boolean }
export type ReviewDraft = Omit<CreateCodeReviewItem, 'review_id' | 'round_id' | 'author' | 'status' | 'answer' | 'carried_from_item_id' | 'outdated'>
export type DraftPatch = Partial<Pick<CodeReviewItem, 'scope' | 'file' | 'line_start' | 'line_end' | 'side' | 'kind' | 'text' | 'refs' | 'code_snippet'>>
export interface ReviewAttention { project_id: string; review_id: string; origin: 'project' | 'task'; origin_id: string; count: number; items: CodeReviewItem[] }
export interface ReviewDetail {
  review: CodeReview; read_only: boolean; items: CodeReviewItem[]; rounds: CodeReviewRound[]; file_views: CodeReviewFileView[]
  chats: { session_id: string | null; events: { seq: number; type: string; payload: unknown; created_at: string }[] }[]
}
export interface CurrentReview {
  repository: RepositoryInfo | null; review: CodeReview | null; items: CodeReviewItem[]; rounds: CodeReviewRound[]
  summary: { head_start: string; head_current: string | null; commits: number | null; rounds: number; items: number; unresolved: number } | null
  file_views: (CodeReviewFileView & { current_hash: string | null; viewed: boolean; changed_after_view: boolean })[]
  other_reviews: CodeReview[]; running_other_reviews: CodeReview[]; agent_working: boolean; attention: number; head_changed: boolean
}
/** A comparison other than «against HEAD»: both ends are accepted by the per-file diff (`base`/`end`). */
export interface BaseChanges { base: string; end: string; changes: GitChange[]; stats: Record<string, LineStat> }
export type ReviewHistory = CodeReview & { read_only: boolean; commits: number | null; rounds: number; items: number; resolved: number; unresolved: number }
