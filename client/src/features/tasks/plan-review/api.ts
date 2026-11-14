import type { Endpoints } from '@contracts'
import { api } from '@core/api'
import type { Launch, Remark, ReviewTarget } from './types'
const path = (project: string, task: string) => `/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}/plan-reviews`
// The plan is the default target; a document is selected by the query, the other paths belong to the review itself.
const query = (target: ReviewTarget) => target === 'plan' ? '' : '?target=' + target
export const planReviewApi = {
  list: (p: string, t: string, target: ReviewTarget = 'plan') => api.get<Endpoints['GET /api/projects/:projectId/tasks/:taskId/plan-reviews']['response']>(path(p, t) + query(target)),
  detail: (p: string, t: string, id: string) => api.get<Endpoints['GET /api/projects/:projectId/tasks/:taskId/plan-reviews/:id']['response']>(path(p, t) + '/' + id),
  skills: (p: string, t: string, target: ReviewTarget = 'plan') => api.get<Endpoints['GET /api/projects/:projectId/tasks/:taskId/plan-reviews/skills']['response']>(path(p, t) + '/skills' + query(target)),
  launch: (p: string, t: string, input: Launch, target: ReviewTarget = 'plan') => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/plan-reviews/launch']['response']>(path(p, t) + '/launch' + query(target), input),
  recipients: (p: string, t: string, target: ReviewTarget = 'plan') => api.get<Endpoints['GET /api/projects/:projectId/tasks/:taskId/plan-reviews/recipients']['response']>(path(p, t) + '/recipients' + query(target)),
  decision: (p: string, t: string, id: string, rid: string, status: Remark['status'], comment: string) =>
    api.put<Endpoints['PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/decision']['response']>(path(p, t) + '/' + id + '/remarks/' + rid + '/decision', { status, comment }),
  edit: (p: string, t: string, id: string, rid: string, text: string, suggestion: string) =>
    api.put<Endpoints['PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/text']['response']>(path(p, t) + '/' + id + '/remarks/' + rid + '/text', { text, suggestion }),
  discuss: (p: string, t: string, id: string) => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/discuss']['response']>(path(p, t) + '/' + id + '/discuss', {}),
  message: (p: string, t: string, id: string, rid: string, text: string) =>
    api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/messages']['response']>(path(p, t) + '/' + id + '/remarks/' + rid + '/messages', { text }),
  send: (p: string, t: string, id: string, input: { session_id?: string | null } & Partial<Launch>) =>
    api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/send']['response']>(path(p, t) + '/' + id + '/send', input),
}

