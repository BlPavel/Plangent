import { api, workspaceApi } from '@core/api'
import type { Task, WorkEntry, Workspace } from '@core/models'
const root = (p: string) => '/projects/' + encodeURIComponent(p)
const task = (p: string, t: string) => root(p) + '/tasks/' + encodeURIComponent(t)
export interface ErrandInput { text: string; agent_id?: string; model?: string; policy?: string; base_branch?: string; auto_review?: boolean }
export const workApi = {
  list: (p: string) => api.get<WorkEntry[]>(root(p) + '/work'),
  attention: () => api.get<{ projectId: string; count: number }[]>('/work/attention'),
  close: (p: string, t: string, discard = false) => api.post<Task>(task(p, t) + '/close', { discard }),
  reopen: (p: string, t: string) => api.post<Task>(task(p, t) + '/reopen', {}),
  cancel: (p: string, t: string, mode: 'keep' | 'discard') => api.post<Task>(task(p, t) + '/cancel', { mode }),
  addPlan: (p: string, t: string) => api.post<Task>(task(p, t) + '/add-plan', {}),
  remove: (p: string, t: string, discard = false) => api.delete<void>(task(p, t) + (discard ? '?discard=1' : '')),
  errand: (p: string, input: ErrandInput) => api.post<{ task: Task }>(root(p) + '/errands', input),
  errandFrom: (p: string, t: string, input: ErrandInput) => api.post<{ task: Task }>(task(p, t) + '/errand', input),
  chat: (p: string, t: string, agent_id?: string, workspaceId?: string) => workspaceApi(workspaceId).post<import('@features/agent-chat').ChatSession>(task(p, t) + '/chat', { agent_id }),
  review: (p: string, t: string, input: object = {}, workspaceId?: string) => workspaceApi(workspaceId).post(task(p, t) + '/review', input),
  check: (p: string, t: string, workspaceId?: string) => workspaceApi(workspaceId).get(task(p, t) + '/check'),
  file: (p: string, t: string, file: string, workspaceId?: string) => workspaceApi(workspaceId).get(task(p, t) + '/check/file?file=' + encodeURIComponent(file)),
  send: (p: string, t: string, item_ids: string[], agent_id?: string, workspaceId?: string) => workspaceApi(workspaceId).post(task(p, t) + '/check/send', { item_ids, agent_id }),
}
export const workspacesApi = {
  list: (p: string) => api.get<Workspace[]>(root(p) + '/workspaces'),
  viewing: (p: string) => api.get<Workspace | null>(root(p) + '/workspaces/viewing'),
  view: (p: string, workspaceId: string | null, confirmed = false) => api.put<{ workspace: Workspace | null; warnings: ViewingWarnings }>(root(p) + '/workspaces/viewing', { workspaceId, confirmed }),
  recreate: (p: string, w: string, discard = false) => api.post<Workspace>(root(p) + '/workspaces/' + encodeURIComponent(w) + '/recreate', { discard }),
}
export interface ViewingWarnings { agentWorking: boolean; terminals: { id: string; title: string; cwd: string; workspaceId: string | null; processes: { pid: number; name: string }[] }[] }
