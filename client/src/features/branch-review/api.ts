import { api } from '@core/api'
import type { BranchList, BranchQuestions, BranchReview, MrInfo, MrList, Remarks, ReviewSkill, ReviewThread } from './types'

const base = (scope: string) => '/projects/' + encodeURIComponent(scope) + '/branch-review'
const review = (scope: string, id: string) => base(scope) + '/' + encodeURIComponent(id)
const part = (value: string | number) => encodeURIComponent(String(value))

export const branchReviewApi = {
  branches: (scope: string) => api.get<BranchList>(base(scope) + '/branches'),
  fetch: (scope: string) => api.post<BranchList>(base(scope) + '/fetch', {}),
  open: (scope: string, branch: string, baseRef: string) => api.post<BranchReview>(base(scope) + '/open', { branch, base: baseRef }),
  mergeRequests: (scope: string) => api.get<MrList>(base(scope) + '/merge-requests'),
  openMergeRequest: (scope: string, iid: number) => api.post<BranchReview>(base(scope) + '/merge-requests/open', { iid }),
  skills: (scope: string) => api.get<ReviewSkill[]>(base(scope) + '/skills'),
  detail: (scope: string, id: string) => api.get<BranchReview>(review(scope, id)),
  refresh: (scope: string, id: string) => api.post<BranchReview>(review(scope, id) + '/refresh', {}),
  acknowledge: (scope: string, id: string) => api.post<BranchReview>(review(scope, id) + '/acknowledge', {}),
  setContext: (scope: string, id: string, input: { context?: string; task_id?: string | null; skill_id?: string | null }) => api.put<BranchReview>(review(scope, id) + '/context', input),
  diff: (scope: string, id: string, path: string, signal?: AbortSignal) => api.get<{ diff: string }>(review(scope, id) + '/diff?path=' + encodeURIComponent(path), signal),
  file: (scope: string, id: string, path: string, signal?: AbortSignal) => api.get<{ content: string }>(review(scope, id) + '/file?path=' + encodeURIComponent(path), signal),
  threads: (scope: string, id: string) => api.get<ReviewThread[]>(review(scope, id) + '/threads'),
  openThread: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number }) => api.post<ReviewThread>(review(scope, id) + '/threads', input),
  finish: (scope: string, id: string) => api.post<{ finished: boolean }>(review(scope, id) + '/finish', {}),

  mr: (scope: string, id: string) => api.get<MrInfo>(review(scope, id) + '/mr'),
  approve: (scope: string, id: string, approved: boolean) => api.post<MrInfo>(review(scope, id) + '/mr/approve', { approved }),
  replyThread: (scope: string, id: string, discussion: string, body: string) => api.post<MrInfo>(review(scope, id) + '/mr/threads/' + part(discussion) + '/reply', { body }),
  resolveThread: (scope: string, id: string, discussion: string, resolved: boolean) => api.put<MrInfo>(review(scope, id) + '/mr/threads/' + part(discussion) + '/resolved', { resolved }),
  editNote: (scope: string, id: string, discussion: string, note: number, body: string) => api.put<MrInfo>(review(scope, id) + '/mr/threads/' + part(discussion) + '/notes/' + note, { body }),
  deleteNote: (scope: string, id: string, discussion: string, note: number) => api.delete<MrInfo>(review(scope, id) + '/mr/threads/' + part(discussion) + '/notes/' + note),

  remarks: (scope: string, id: string) => api.get<Remarks>(review(scope, id) + '/remarks'),
  addRemark: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number; body: string }) => api.post<Remarks>(review(scope, id) + '/remarks', input),
  editRemark: (scope: string, id: string, remark: string, input: { body?: string }) => api.put<Remarks>(review(scope, id) + '/remarks/' + part(remark), input),
  removeRemark: (scope: string, id: string, remark: string) => api.delete<Remarks>(review(scope, id) + '/remarks/' + part(remark)),
  detachRemark: (scope: string, id: string, remark: string) => api.post<Remarks>(review(scope, id) + '/remarks/' + part(remark) + '/detach', {}),
  recoverRemark: (scope: string, id: string, remark: string, published: boolean) => api.post<Remarks>(review(scope, id) + '/remarks/' + part(remark) + '/recover', { published }),
  publish: (scope: string, id: string, ids: string[]) => api.post<Remarks>(review(scope, id) + '/remarks/publish', { ids, confirmed: true }),
  markSent: (scope: string, id: string, ids: string[]) => api.post<Remarks>(review(scope, id) + '/remarks/mark-sent', { ids }),

  analyze: (scope: string, id: string, input: { note?: string }) => api.post<{ thread: ReviewThread }>(review(scope, id) + '/analyze', input),
  restart: (scope: string, id: string) => api.post<BranchReview>(review(scope, id) + '/restart', {}),
  checkFixes: (scope: string, id: string) => api.post<BranchQuestions & { thread: ReviewThread }>(review(scope, id) + '/check-fixes', {}),
  questions: (scope: string, id: string) => api.get<BranchQuestions>(review(scope, id) + '/questions'),
  addQuestion: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number; text: string }) => api.post<BranchQuestions>(review(scope, id) + '/questions', input),
  reply: (scope: string, id: string, question: string, text: string) => api.post<BranchQuestions>(review(scope, id) + '/questions/' + question + '/messages', { text }),
  editMessage: (scope: string, id: string, question: string, message: string, text: string) => api.put<BranchQuestions>(review(scope, id) + '/questions/' + question + '/messages/' + message, { text }),
  removeMessage: (scope: string, id: string, question: string, message: string) => api.delete<BranchQuestions>(review(scope, id) + '/questions/' + question + '/messages/' + message),
  closeQuestion: (scope: string, id: string, question: string, closed: boolean) => api.post<BranchQuestions>(review(scope, id) + '/questions/' + question + '/close', { closed }),
  send: (scope: string, id: string, input: { question_ids?: string[] }) => api.post<BranchQuestions & { thread: ReviewThread }>(review(scope, id) + '/questions/send', input),
  stop: (scope: string, id: string) => api.post<BranchQuestions>(review(scope, id) + '/questions/stop', {}),
}
