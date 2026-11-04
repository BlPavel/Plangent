import type { Endpoints } from '@contracts'
import { endpoint } from '@core/api/endpoint'
import { api } from '@core/api'


const base = (scope: string) => '/projects/' + encodeURIComponent(scope) + '/branch-review'
const review = (scope: string, id: string) => base(scope) + '/' + encodeURIComponent(id)
const part = (value: string | number) => encodeURIComponent(String(value))

export const branchReviewApi = {
  branches: (scope: string) => branchReviewEndpoints.getProjectsByProjectIdBranchReviewBranches({ params: { projectId: scope } }),
  fetch: (scope: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/fetch']['response']>(base(scope) + '/fetch', {}),
  open: (scope: string, branch: string, baseRef: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/open']['response']>(base(scope) + '/open', { branch, base: baseRef }),
  mergeRequests: (scope: string) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/merge-requests']['response']>(base(scope) + '/merge-requests'),
  openMergeRequest: (scope: string, iid: number) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/merge-requests/open']['response']>(base(scope) + '/merge-requests/open', { iid }),
  skills: (scope: string) => branchReviewEndpoints.getProjectsByProjectIdBranchReviewSkills({ params: { projectId: scope } }),
  detail: (scope: string, id: string) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/:id']['response']>(review(scope, id)),
  refresh: (scope: string, id: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/refresh']['response']>(review(scope, id) + '/refresh', {}),
  acknowledge: (scope: string, id: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/acknowledge']['response']>(review(scope, id) + '/acknowledge', {}),
  setContext: (scope: string, id: string, input: { context?: string; task_id?: string | null; skill_id?: string | null }) => api.put<Endpoints['PUT /api/projects/:projectId/branch-review/:id/context']['response']>(review(scope, id) + '/context', input),
  diff: (scope: string, id: string, path: string, signal?: AbortSignal) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/:id/diff']['response']>(review(scope, id) + '/diff?path=' + encodeURIComponent(path), signal),
  file: (scope: string, id: string, path: string, signal?: AbortSignal) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/:id/file']['response']>(review(scope, id) + '/file?path=' + encodeURIComponent(path), signal),
  threads: (scope: string, id: string) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/:id/threads']['response']>(review(scope, id) + '/threads'),
  openThread: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number }) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/threads']['response']>(review(scope, id) + '/threads', input),
  finish: (scope: string, id: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/finish']['response']>(review(scope, id) + '/finish', {}),

  mr: (scope: string, id: string) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/:id/mr']['response']>(review(scope, id) + '/mr'),
  approve: (scope: string, id: string, approved: boolean) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/mr/approve']['response']>(review(scope, id) + '/mr/approve', { approved }),
  replyThread: (scope: string, id: string, discussion: string, body: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/mr/threads/:did/reply']['response']>(review(scope, id) + '/mr/threads/' + part(discussion) + '/reply', { body }),
  resolveThread: (scope: string, id: string, discussion: string, resolved: boolean) => api.put<Endpoints['PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/resolved']['response']>(review(scope, id) + '/mr/threads/' + part(discussion) + '/resolved', { resolved }),
  editNote: (scope: string, id: string, discussion: string, note: number, body: string) => api.put<Endpoints['PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid']['response']>(review(scope, id) + '/mr/threads/' + part(discussion) + '/notes/' + note, { body }),
  deleteNote: (scope: string, id: string, discussion: string, note: number) => api.delete<Endpoints['DELETE /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid']['response']>(review(scope, id) + '/mr/threads/' + part(discussion) + '/notes/' + note),

  remarks: (scope: string, id: string) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/:id/remarks']['response']>(review(scope, id) + '/remarks'),
  addRemark: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number; body: string }) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/remarks']['response']>(review(scope, id) + '/remarks', input),
  editRemark: (scope: string, id: string, remark: string, input: { body?: string }) => api.put<Endpoints['PUT /api/projects/:projectId/branch-review/:id/remarks/:rid']['response']>(review(scope, id) + '/remarks/' + part(remark), input),
  removeRemark: (scope: string, id: string, remark: string) => api.delete<Endpoints['DELETE /api/projects/:projectId/branch-review/:id/remarks/:rid']['response']>(review(scope, id) + '/remarks/' + part(remark)),
  detachRemark: (scope: string, id: string, remark: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/remarks/:rid/detach']['response']>(review(scope, id) + '/remarks/' + part(remark) + '/detach', {}),
  recoverRemark: (scope: string, id: string, remark: string, published: boolean) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/remarks/:rid/recover']['response']>(review(scope, id) + '/remarks/' + part(remark) + '/recover', { published }),
  publish: (scope: string, id: string, ids: string[]) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/remarks/publish']['response']>(review(scope, id) + '/remarks/publish', { ids, confirmed: true }),
  markSent: (scope: string, id: string, ids: string[]) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/remarks/mark-sent']['response']>(review(scope, id) + '/remarks/mark-sent', { ids }),

  analyze: (scope: string, id: string, input: { note?: string }) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/analyze']['response']>(review(scope, id) + '/analyze', input),
  restart: (scope: string, id: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/restart']['response']>(review(scope, id) + '/restart', {}),
  checkFixes: (scope: string, id: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/check-fixes']['response']>(review(scope, id) + '/check-fixes', {}),
  questions: (scope: string, id: string) => api.get<Endpoints['GET /api/projects/:projectId/branch-review/:id/questions']['response']>(review(scope, id) + '/questions'),
  addQuestion: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number; text: string }) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/questions']['response']>(review(scope, id) + '/questions', input),
  reply: (scope: string, id: string, question: string, text: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/questions/:qid/messages']['response']>(review(scope, id) + '/questions/' + question + '/messages', { text }),
  editMessage: (scope: string, id: string, question: string, message: string, text: string) => api.put<Endpoints['PUT /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid']['response']>(review(scope, id) + '/questions/' + question + '/messages/' + message, { text }),
  removeMessage: (scope: string, id: string, question: string, message: string) => api.delete<Endpoints['DELETE /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid']['response']>(review(scope, id) + '/questions/' + question + '/messages/' + message),
  closeQuestion: (scope: string, id: string, question: string, closed: boolean) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/questions/:qid/close']['response']>(review(scope, id) + '/questions/' + question + '/close', { closed }),
  send: (scope: string, id: string, input: { question_ids?: string[] }) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/questions/send']['response']>(review(scope, id) + '/questions/send', input),
  stop: (scope: string, id: string) => api.post<Endpoints['POST /api/projects/:projectId/branch-review/:id/questions/stop']['response']>(review(scope, id) + '/questions/stop', {}),
}

export const branchReviewEndpoints = {
  getProjectsByProjectIdBranchReviewBranches: endpoint('GET /api/projects/:projectId/branch-review/branches'),
  getProjectsByProjectIdBranchReviewSkills: endpoint('GET /api/projects/:projectId/branch-review/skills'),
}
