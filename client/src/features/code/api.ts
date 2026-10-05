import { api } from '@core/api'
import type { RepositoryInfo, GitChange, LineStat, TreeEntry, CodeFile, DiffOptions, SearchOptions, SearchEvent, ReviewDraft, DraftPatch, CodeReview, CodeReviewItem, CodeReviewMessage, CodeReviewRound, CodeReviewFileView, ReviewDetail, CurrentReview, ReviewHistory, ReviewAttention, BaseChanges } from './types'
const id = encodeURIComponent
function query(values: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value))
  const result = params.toString()
  return result ? '?' + result : ''
}
const code = (projectId: string) => `/projects/${id(projectId)}/code`
const reviews = (projectId: string) => `/projects/${id(projectId)}/code-reviews`
const review = (p: string, r: string) => `${reviews(p)}/${id(r)}`
const item = (p: string, r: string, i: string) => `${review(p, r)}/items/${id(i)}`
export const codeApi = {
  repository: (p: string, signal?: AbortSignal) => api.get<RepositoryInfo | null>(code(p) + '/repository', signal),
  changes: (p: string, signal?: AbortSignal) => api.get<GitChange[]>(code(p) + '/changes', signal),
  stats: (p: string, signal?: AbortSignal) => api.get<Record<string, LineStat>>(code(p) + '/stats', signal),
  files: (p: string, includeIgnored = false, signal?: AbortSignal) => api.get<string[]>(code(p) + '/files' + query({ includeIgnored }), signal),
  tree: (p: string, path = '', includeIgnored = false, signal?: AbortSignal) => api.get<TreeEntry[]>(code(p) + '/tree' + query({ path, includeIgnored }), signal),
  file: (p: string, path: string, signal?: AbortSignal) => api.get<CodeFile>(code(p) + '/file' + query({ path }), signal),
  imageUrl: (p: string, path: string) => '/api' + code(p) + '/image' + query({ path }),
  oldFile: (p: string, path: string, base = 'HEAD', signal?: AbortSignal) => api.get<{ content: string }>(code(p) + '/old-file' + query({ path, base }), signal),
  diff: (p: string, path: string, options: DiffOptions = {}, signal?: AbortSignal) => api.get<{ diff: string }>(code(p) + '/diff' + query({ path, ...options }), signal),
  search: (p: string, options: SearchOptions, signal?: AbortSignal) => {
    const { query: q, ...rest } = options
    return api.stream<SearchEvent>(code(p) + '/search' + query({ q, ...rest }), signal)
  },
}
export const codeReviewsApi = {
  current: (p: string, signal?: AbortSignal) => api.get<CurrentReview>(reviews(p) + '/current', signal),
  detail: (p: string, r: string, signal?: AbortSignal) => api.get<ReviewDetail>(review(p, r), signal),
  history: (p: string, signal?: AbortSignal) => api.get<ReviewHistory[]>(reviews(p), signal),
  attention: (p: string, signal?: AbortSignal) => api.get<ReviewAttention[]>(reviews(p) + '/attention', signal),
  addDraft: (p: string, data: ReviewDraft, origin: 'project' | 'task' = 'project', originId = p) => api.post<{ review: CodeReview; item: CodeReviewItem }>(reviews(p) + '/items', { ...data, origin, origin_id: originId }),
  updateDraft: (p: string, r: string, i: string, data: DraftPatch) => api.patch<CodeReviewItem>(item(p, r, i), data),
  removeItem: (p: string, r: string, i: string) => api.delete<void>(item(p, r, i)),
  makeGeneral: (p: string, r: string, i: string) => api.post<CodeReviewItem>(item(p, r, i) + '/general', {}),
  addMessage: (p: string, r: string, i: string, data: { kind: 'text' | 'implement'; text: string; choice?: number }) => api.post<CodeReviewMessage>(item(p, r, i) + '/messages', data),
  removeMessage: (p: string, r: string, i: string, m: string) => api.delete<void>(item(p, r, i) + '/messages/' + id(m)),
  closeItem: (p: string, r: string, i: string, resolution: 'accept' | 'answered' | 'reject' | 'reopen') => api.post<CodeReviewItem>(item(p, r, i) + '/close', { resolution }),
  sendRound: (p: string, r: string, sessionId: string, note?: string, itemIds?: string[]) => api.post<{ round: CodeReviewRound; items: CodeReviewItem[] }>(review(p, r) + '/rounds', { session_id: sessionId, note, item_ids: itemIds }),
  stop: (p: string, r: string) => api.post<{ stopped: number }>(review(p, r) + '/stop', {}),
  fileItems: (p: string, r: string, path: string, side: 'new' | 'old' = 'new', signal?: AbortSignal) => api.get<CodeReviewItem[]>(review(p, r) + '/file-items' + query({ path, side }), signal),
  diff: (p: string, r: string, path: string, signal?: AbortSignal) => api.get<{ diff: string }>(review(p, r) + '/diff' + query({ path }), signal),
  baseChanges: (p: string, r: string, base: 'agent' | 'review', round?: string, signal?: AbortSignal) => api.get<BaseChanges>(review(p, r) + '/changes' + query({ base, round }), signal),
  markViewed: (p: string, r: string, path: string, viewed: boolean) => api.put<CodeReviewFileView | null>(review(p, r) + '/viewed', { path, viewed }),
  finish: (p: string, r: string, mode: 'require_resolved' | 'carry' | 'close' = 'require_resolved') => api.post<{ review: CodeReview; next_review: CodeReview | null }>(review(p, r) + '/finish', { mode }),
  markViewedCurrent: (p: string, path: string, viewed: boolean, origin: 'project' | 'task' = 'project', originId = p) => api.put<{ review: CodeReview | null; view: CodeReviewFileView | null }>(reviews(p) + '/current/viewed', { path, viewed, origin, origin_id: originId }),
  removeReview: (p: string, r: string) => api.delete<void>(review(p, r)),
}
