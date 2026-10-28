import { api } from '@core/api'
import type { Detail, Review, Skill, Launch, Remark } from './types'
const path = (project: string, task: string) => `/projects/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task)}/plan-reviews`
export const planReviewApi = {
  list: (p: string, t: string) => api.get<Review[]>(path(p, t)),
  detail: (p: string, t: string, id: string) => api.get<Detail>(path(p, t) + '/' + id),
  skills: (p: string, t: string) => api.get<Skill[]>(path(p, t) + '/skills'),
  launch: (p: string, t: string, input: Launch) => api.post<Detail>(path(p, t) + '/launch', input),
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

