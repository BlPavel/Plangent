import { api } from '@core/api'
import type { BranchList, BranchReview, ReviewThread } from './types'

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
  openThread: (scope: string, id: string, input: { path?: string; side?: 'old' | 'new'; line?: number }) => api.post<ReviewThread>(review(scope, id) + '/threads', input),
  finish: (scope: string, id: string) => api.post<{ finished: boolean }>(review(scope, id) + '/finish', {}),
}
