import { api } from '@core/api'
import type { BranchList, BranchQuestions, BranchReview, ReviewThread } from './types'

const base = (scope: string) => '/projects/' + encodeURIComponent(scope) + '/branch-review'
const review = (scope: string, id: string) => base(scope) + '/' + encodeURIComponent(id)

export const branchReviewApi = {
  branches: (scope: string) => api.get<BranchList>(base(scope) + '/branches'),
  fetch: (scope: string) => api.post<BranchList>(base(scope) + '/fetch', {}),
  open: (scope: string, branch: string, baseRef: string) => api.post<BranchReview>(base(scope) + '/open', { branch, base: baseRef }),
  detail: (scope: string, id: string) => api.get<BranchReview>(review(scope, id)),
  refresh: (scope: string, id: string) => api.post<BranchReview>(review(scope, id) + '/refresh', {}),
  acknowledge: (scope: string, id: string) => api.post<BranchReview>(review(scope, id) + '/acknowledge', {}),
  diff: (scope: string, id: string, path: string, signal?: AbortSignal) => api.get<{ diff: string }>(review(scope, id) + '/diff?path=' + encodeURIComponent(path), signal),
  file: (scope: string, id: string, path: string, signal?: AbortSignal) => api.get<{ content: string }>(review(scope, id) + '/file?path=' + encodeURIComponent(path), signal),
  viewed: (scope: string, id: string, path: string, viewed: boolean) => api.put<BranchReview>(review(scope, id) + '/viewed', { path, viewed }),
  threads: (scope: string, id: string) => api.get<ReviewThread[]>(review(scope, id) + '/threads'),
  openThread: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number; agent?: { agent_id: string; model: string; mode: string; config: Record<string, string> } }) => api.post<ReviewThread>(review(scope, id) + '/threads', input),
  questions: (scope: string, id: string) => api.get<BranchQuestions>(review(scope, id) + '/questions'),
  addQuestion: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number; text: string }) => api.post<BranchQuestions>(review(scope, id) + '/questions', input),
  reply: (scope: string, id: string, question: string, text: string) => api.post<BranchQuestions>(review(scope, id) + '/questions/' + question + '/messages', { text }),
  editMessage: (scope: string, id: string, question: string, message: string, text: string) => api.put<BranchQuestions>(review(scope, id) + '/questions/' + question + '/messages/' + message, { text }),
  removeMessage: (scope: string, id: string, question: string, message: string) => api.delete<BranchQuestions>(review(scope, id) + '/questions/' + question + '/messages/' + message),
  closeQuestion: (scope: string, id: string, question: string, closed: boolean) => api.post<BranchQuestions>(review(scope, id) + '/questions/' + question + '/close', { closed }),
  send: (scope: string, id: string, input: { agent?: { agent_id: string; model: string; mode: string; config: Record<string, string> }; question_ids?: string[] }) => api.post<BranchQuestions & { thread: ReviewThread }>(review(scope, id) + '/questions/send', input),
  stop: (scope: string, id: string) => api.post<BranchQuestions>(review(scope, id) + '/questions/stop', {}),
  finish: (scope: string, id: string) => api.post<{ finished: boolean }>(review(scope, id) + '/finish', {}),
}
