import { api } from '@core/api'
import type { Detail, Review, Skill, Launch, Remark, ReviewTarget } from './types'
const path = (project: string, task: string) => `/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}/plan-reviews`
// The plan is the default target; a document is selected by the query, the other paths belong to the review itself.
const query = (target: ReviewTarget) => target === 'plan' ? '' : '?target=' + target
export const planReviewApi = {
  list: (p: string, t: string, target: ReviewTarget = 'plan') => api.get<Review[]>(path(p, t) + query(target)),
  detail: (p: string, t: string, id: string) => api.get<Detail>(path(p, t) + '/' + id),
  skills: (p: string, t: string, target: ReviewTarget = 'plan') => api.get<Skill[]>(path(p, t) + '/skills' + query(target)),
  launch: (p: string, t: string, input: Launch, target: ReviewTarget = 'plan') => api.post<Detail>(path(p, t) + '/launch' + query(target), input),
  decision: (p: string, t: string, id: string, rid: string, status: Remark['status'], comment: string) =>
    api.put<Detail>(path(p, t) + '/' + id + '/remarks/' + rid + '/decision', { status, comment }),
  edit: (p: string, t: string, id: string, rid: string, text: string, suggestion: string) =>
    api.put<Detail>(path(p, t) + '/' + id + '/remarks/' + rid + '/text', { text, suggestion }),
  discuss: (p: string, t: string, id: string) => api.post<Detail>(path(p, t) + '/' + id + '/discuss', {}),
  message: (p: string, t: string, id: string, rid: string, text: string) =>
    api.post<Detail>(path(p, t) + '/' + id + '/remarks/' + rid + '/messages', { text }),
  send: (p: string, t: string, id: string, input: Partial<Launch>) =>
    api.post<Detail>(path(p, t) + '/' + id + '/send', input),
}

