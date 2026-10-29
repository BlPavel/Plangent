import { workspaceApi } from '@core/api'
import type { RepositoryInfo, GitChange, LineStat, TreeEntry, CodeFile, DiffOptions, SearchOptions, SearchEvent, ReviewDraft, DraftPatch, CodeReview, CodeReviewItem, CodeReviewMessage, CodeReviewRound, ReviewDetail, CurrentReview, ReviewHistory, ReviewAttention, BaseChanges, ExternalThreads } from './types'
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
  repository: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<RepositoryInfo | null>(code(p) + '/repository', signal),
  changes: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<GitChange[]>(code(p) + '/changes', signal),
  stats: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Record<string, LineStat>>(code(p) + '/stats', signal),
  files: (p: string, includeIgnored = false, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<string[]>(code(p) + '/files' + query({ includeIgnored }), signal),
  tree: (p: string, path = '', includeIgnored = false, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<TreeEntry[]>(code(p) + '/tree' + query({ path, includeIgnored }), signal),
  file: (p: string, path: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<CodeFile>(code(p) + '/file' + query({ path }), signal),
  imageUrl: (p: string, path: string, workspaceId?: string) => '/api' + code(p) + '/image' + query({ path, workspace: workspaceId }),
  oldFile: (p: string, path: string, base = 'HEAD', signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<{ content: string }>(code(p) + '/old-file' + query({ path, base }), signal),
  diff: (p: string, path: string, options: DiffOptions = {}, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<{ diff: string }>(code(p) + '/diff' + query({ path, ...options }), signal),
  search: (p: string, options: SearchOptions, signal?: AbortSignal, workspaceId?: string) => {
    const { query: q, ...rest } = options
    return workspaceApi(workspaceId).stream<SearchEvent>(code(p) + '/search' + query({ q, ...rest }), signal)
  },
}
export const codeReviewsApi = {
  remoteComparison: (p: string, ref: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<BaseChanges>(reviews(p) + '/current/comparison' + query({ ref }), signal),
  current: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<CurrentReview>(reviews(p) + '/current', signal),
  detail: (p: string, r: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<ReviewDetail>(review(p, r), signal),
  history: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<ReviewHistory[]>(reviews(p), signal),
  attention: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<ReviewAttention[]>(reviews(p) + '/attention', signal),
  addDraft: (p: string, data: ReviewDraft, origin: 'project' | 'task' = 'project', originId = p, workspaceId?: string) => workspaceApi(workspaceId).post<{ review: CodeReview; item: CodeReviewItem }>(reviews(p) + '/items', { ...data, origin, origin_id: originId }),
  updateDraft: (p: string, r: string, i: string, data: DraftPatch, workspaceId?: string) => workspaceApi(workspaceId).patch<CodeReviewItem>(item(p, r, i), data),
  removeItem: (p: string, r: string, i: string, workspaceId?: string) => workspaceApi(workspaceId).delete<void>(item(p, r, i)),
  makeGeneral: (p: string, r: string, i: string, workspaceId?: string) => workspaceApi(workspaceId).post<CodeReviewItem>(item(p, r, i) + '/general', {}),
  addMessage: (p: string, r: string, i: string, data: { kind: 'text' | 'implement'; text: string; choice?: number }, workspaceId?: string) => workspaceApi(workspaceId).post<CodeReviewMessage>(item(p, r, i) + '/messages', data),
  removeMessage: (p: string, r: string, i: string, m: string, workspaceId?: string) => workspaceApi(workspaceId).delete<void>(item(p, r, i) + '/messages/' + id(m)),
  closeItem: (p: string, r: string, i: string, resolution: 'accept' | 'answered' | 'reject' | 'reopen', workspaceId?: string) => workspaceApi(workspaceId).post<CodeReviewItem>(item(p, r, i) + '/close', { resolution }),
  sendRound: (p: string, r: string, sessionId: string, note?: string, itemIds?: string[], workspaceId?: string) => workspaceApi(workspaceId).post<{ round: CodeReviewRound; items: CodeReviewItem[] }>(review(p, r) + '/rounds', { session_id: sessionId, note, item_ids: itemIds }),
  stop: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).post<{ stopped: number }>(review(p, r) + '/stop', {}),
  fileItems: (p: string, r: string, path: string, side: 'new' | 'old' = 'new', signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<CodeReviewItem[]>(review(p, r) + '/file-items' + query({ path, side }), signal),
  diff: (p: string, r: string, path: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<{ diff: string }>(review(p, r) + '/diff' + query({ path }), signal),
  baseChanges: (p: string, r: string, base: 'agent' | 'review', round?: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<BaseChanges>(review(p, r) + '/changes' + query({ base, round }), signal),
  finish: (p: string, r: string, mode: 'require_resolved' | 'carry' | 'close' = 'require_resolved', workspaceId?: string) => workspaceApi(workspaceId).post<{ review: CodeReview; next_review: CodeReview | null }>(review(p, r) + '/finish', { mode }),
  removeReview: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).delete<void>(review(p, r)),
  external: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<ExternalThreads>(reviews(p) + '/external', signal),
  replyExternal: (p: string, discussion: string, body: string, workspaceId?: string) => workspaceApi(workspaceId).post<ExternalThreads>(reviews(p) + '/external/' + id(discussion) + '/reply', { body, confirmed: true }),
  editExternalNote: (p: string, discussion: string, note: number, body: string, workspaceId?: string) => workspaceApi(workspaceId).put<ExternalThreads>(reviews(p) + '/external/' + id(discussion) + '/notes/' + note, { body }),
  deleteExternalNote: (p: string, discussion: string, note: number, workspaceId?: string) => workspaceApi(workspaceId).delete<ExternalThreads>(reviews(p) + '/external/' + id(discussion) + '/notes/' + note + '?confirmed=true'),
  resolveExternal: (p: string, discussion: string, resolved: boolean, workspaceId?: string) => workspaceApi(workspaceId).put<ExternalThreads>(reviews(p) + '/external/' + id(discussion) + '/resolved', { resolved }),
}

const conflicts = (p: string) => '/projects/' + id(p) + '/conflicts'
type ConflictState = import('./git-types').ConflictState
export const conflictsApi = {
  state: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<ConflictState>(conflicts(p)),
  resolve: (p: string, input: { note?: string; answers?: Record<string, string> } = {}, workspaceId?: string) => workspaceApi(workspaceId).post<ConflictState>(conflicts(p) + '/resolve', input),
  stop: (p: string, workspaceId?: string) => workspaceApi(workspaceId).post<{ stopped: boolean }>(conflicts(p) + '/stop', {}),
}

const git = (p: string) => '/projects/' + id(p) + '/git'
export const gitApi = {
  repository: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<import('./git-types').GitTracking | null>(git(p) + '/repository'),
  branches: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<import('./git-types').GitBranch[]>(git(p) + '/branches'),
  refreshBranches: (p: string, workspaceId?: string) => workspaceApi(workspaceId).post<import('./git-types').GitBranch[]>(git(p) + '/branches/refresh', {}),
  settings: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<import('./git-types').GitPreferences>(git(p) + '/settings'),
  coauthors: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<import('./git-types').Coauthor[]>(git(p) + '/coauthors'),
  operation: (p: string, action: string, input: object = {}, workspaceId?: string) => workspaceApi(workspaceId).post<{ output: string; operationId: string }>(git(p) + '/' + action, input),
  checkMessage: (p: string, input: import('./git-types').CommitInput, workspaceId?: string) => workspaceApi(workspaceId).post<import('./git-types').MessageCheck>(git(p) + '/commit-message', input),
  generateMessage: (p: string, input: { taskId?: string; includeDescription: boolean }, workspaceId?: string) => workspaceApi(workspaceId).post<{ title: string; body: string }>(git(p) + '/generate-message', input),
}
