import type { Endpoints } from '@contracts'
import { endpoint } from '@core/api/endpoint'
import { workspaceApi } from '@core/api'
import type { DiffOptions, SearchOptions, ReviewDraft, DraftPatch} from './types'
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
  repository: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/repository']['response']>(code(p) + '/repository', signal),
  changes: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/changes']['response']>(code(p) + '/changes', signal),
  stats: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/stats']['response']>(code(p) + '/stats', signal),
  files: (p: string, includeIgnored = false, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/files']['response']>(code(p) + '/files' + query({ includeIgnored }), signal),
  tree: (p: string, path = '', includeIgnored = false, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/tree']['response']>(code(p) + '/tree' + query({ path, includeIgnored }), signal),
  file: (p: string, path: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/file']['response']>(code(p) + '/file' + query({ path }), signal),
  imageUrl: (p: string, path: string, workspaceId?: string) => '/api' + code(p) + '/image' + query({ path, workspace: workspaceId }),
  oldFile: (p: string, path: string, base = 'HEAD', signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/old-file']['response']>(code(p) + '/old-file' + query({ path, base }), signal),
  diff: (p: string, path: string, options: DiffOptions = {}, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code/diff']['response']>(code(p) + '/diff' + query({ path, ...options }), signal),
  search: (p: string, options: SearchOptions, signal?: AbortSignal, workspaceId?: string) => {
    const { query: q, ...rest } = options
    return workspaceApi(workspaceId).stream<Exclude<Endpoints['GET /api/projects/:projectId/code/search']['event'], { type: 'error' }>>(code(p) + '/search' + query({ q, ...rest }), signal)
  },
}
export const codeReviewsApi = {
  remoteComparison: (p: string, ref: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/current/comparison']['response']>(reviews(p) + '/current/comparison' + query({ ref }), signal),
  current: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/current']['response']>(reviews(p) + '/current', signal),
  detail: (p: string, r: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/:reviewId']['response']>(review(p, r), signal),
  history: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews']['response']>(reviews(p), signal),
  attention: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/attention']['response']>(reviews(p) + '/attention', signal),
  addDraft: (p: string, data: ReviewDraft, origin: 'project' | 'task' = 'project', originId = p, workspace?: string) => codeEndpoints.addTaskItem({ params: { projectId: p }, body: { ...data, origin, origin_id: originId }, query: { workspace } }),
  updateDraft: (p: string, r: string, i: string, data: DraftPatch, workspaceId?: string) => workspaceApi(workspaceId).patch<Endpoints['PATCH /api/projects/:projectId/code-reviews/:reviewId/items/:itemId']['response']>(item(p, r, i), data),
  removeItem: (p: string, r: string, i: string, workspaceId?: string) => workspaceApi(workspaceId).delete<Endpoints['DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId']['response']>(item(p, r, i)),
  makeGeneral: (p: string, r: string, i: string, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/general']['response']>(item(p, r, i) + '/general', {}),
  addMessage: (p: string, r: string, i: string, body: Endpoints['POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages']['body'], workspace?: string) => codeEndpoints.taskMessage({ params: { projectId: p, reviewId: r, itemId: i }, body, query: { workspace } }),
  removeMessage: (p: string, r: string, i: string, m: string, workspaceId?: string) => workspaceApi(workspaceId).delete<Endpoints['DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages/:messageId']['response']>(item(p, r, i) + '/messages/' + id(m)),
  closeItem: (p: string, r: string, i: string, resolution: Endpoints['POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/close']['body']['resolution'], workspace?: string) => codeEndpoints.rejectTaskItem({ params: { projectId: p, reviewId: r, itemId: i }, body: { resolution }, query: { workspace } }),
  sendRound: (p: string, r: string, sessionId: string, note?: string, itemIds?: string[], workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/code-reviews/:reviewId/rounds']['response']>(review(p, r) + '/rounds', { session_id: sessionId, note, item_ids: itemIds }),
  stop: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/code-reviews/:reviewId/stop']['response']>(review(p, r) + '/stop', {}),
  fileItems: (p: string, r: string, path: string, side: 'new' | 'old' = 'new', signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/:reviewId/file-items']['response']>(review(p, r) + '/file-items' + query({ path, side }), signal),
  diff: (p: string, r: string, path: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/:reviewId/diff']['response']>(review(p, r) + '/diff' + query({ path }), signal),
  baseChanges: (p: string, r: string, base: 'agent' | 'review', round?: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/:reviewId/changes']['response']>(review(p, r) + '/changes' + query({ base, round }), signal),
  finish: (p: string, r: string, mode: 'require_resolved' | 'carry' | 'close' = 'require_resolved', workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/code-reviews/:reviewId/finish']['response']>(review(p, r) + '/finish', { mode }),
  removeReview: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).delete<Endpoints['DELETE /api/projects/:projectId/code-reviews/:reviewId']['response']>(review(p, r)),
  external: (p: string, signal?: AbortSignal, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/code-reviews/external']['response']>(reviews(p) + '/external', signal),
  replyExternal: (p: string, discussion: string, body: string, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/code-reviews/external/:discussionId/reply']['response']>(reviews(p) + '/external/' + id(discussion) + '/reply', { body, confirmed: true }),
  editExternalNote: (p: string, discussion: string, note: number, body: string, workspaceId?: string) => workspaceApi(workspaceId).put<Endpoints['PUT /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId']['response']>(reviews(p) + '/external/' + id(discussion) + '/notes/' + note, { body }),
  deleteExternalNote: (p: string, discussion: string, note: number, workspaceId?: string) => workspaceApi(workspaceId).delete<Endpoints['DELETE /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId']['response']>(reviews(p) + '/external/' + id(discussion) + '/notes/' + note + '?confirmed=true'),
  resolveExternal: (p: string, discussion: string, resolved: boolean, workspaceId?: string) => workspaceApi(workspaceId).put<Endpoints['PUT /api/projects/:projectId/code-reviews/external/:discussionId/resolved']['response']>(reviews(p) + '/external/' + id(discussion) + '/resolved', { resolved }),
}

const conflicts = (p: string) => '/projects/' + id(p) + '/conflicts'
export const conflictsApi = {
  state: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/conflicts']['response']>(conflicts(p)),
  resolve: (p: string, input: { note?: string; answers?: Record<string, string> } = {}, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/conflicts/resolve']['response']>(conflicts(p) + '/resolve', input),
  stop: (p: string, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/conflicts/stop']['response']>(conflicts(p) + '/stop', {}),
}

const git = (p: string) => '/projects/' + id(p) + '/git'
export const gitApi = {
  repository: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/git/repository']['response']>(git(p) + '/repository'),
  branches: (p: string, workspace?: string) => codeEndpoints.getProjectsByProjectIdGitBranches({ params: { projectId: p }, query: { workspace } }),
  refreshBranches: (p: string, workspace?: string) => codeEndpoints.postProjectsByProjectIdGitBranchesRefresh({ params: { projectId: p }, query: { workspace } }),
  settings: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/git/settings']['response']>(git(p) + '/settings'),
  coauthors: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/git/coauthors']['response']>(git(p) + '/coauthors'),
  operation: (p: string, action: string, input: object = {}, workspaceId?: string) => {
    switch (action) {
      case 'stage': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/stage']['response']>(git(p) + '/stage', input)
      case 'unstage': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/unstage']['response']>(git(p) + '/unstage', input)
      case 'discard': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/discard']['response']>(git(p) + '/discard', input)
      case 'fetch': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/fetch']['response']>(git(p) + '/fetch', input)
      case 'pull': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/pull']['response']>(git(p) + '/pull', input)
      case 'push': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/push']['response']>(git(p) + '/push', input)
      case 'pull-rebase': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/pull-rebase']['response']>(git(p) + '/pull-rebase', input)
      case 'push-force': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/push-force']['response']>(git(p) + '/push-force', input)
      case 'switch': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/switch']['response']>(git(p) + '/switch', input)
      case 'branch': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/branch']['response']>(git(p) + '/branch', input)
      case 'commit': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/commit']['response']>(git(p) + '/commit', input)
      case 'cancel': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/cancel']['response']>(git(p) + '/cancel', input)
      default: throw new Error('Unknown Git operation: ' + action)
    }
  },
  checkMessage: (p: string, input: import('./git-types').CommitInput, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/commit-message']['response']>(git(p) + '/commit-message', input),
  generateMessage: (p: string, input: { taskId?: string; includeDescription: boolean }, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/git/generate-message']['response']>(git(p) + '/generate-message', input),
}

export const codeEndpoints = {
  addTaskItem: endpoint('POST /api/projects/:projectId/code-reviews/items'),
  rejectTaskItem: endpoint('POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/close'),
  taskMessage: endpoint('POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages'),
  postProjectsByProjectIdGitBranchesRefresh: endpoint('POST /api/projects/:projectId/git/branches/refresh'),
  getProjectsByProjectIdGitBranches: endpoint('GET /api/projects/:projectId/git/branches'),
}
