import type { Endpoints } from '@contracts'
import { endpoint } from '@core/api/endpoint'
import { api } from '@core/api'
export const analysisText = (url: string) => api.text(url.replace(/^\/api/, ''))
import type { MaterialType, PreparationStage} from '@contracts'
const root = (p: string) => '/projects/' + encodeURIComponent(p)
const task = (p: string, t: string) => root(p) + '/tasks/' + encodeURIComponent(t)
/** A new errand: номер and/or описание, who does it and where (see the server's ErrandInput); `text` is sent to the agent at once. */
export type ErrandInput = Endpoints['POST /api/projects/:projectId/errands']['body']
/** A new task with a plan: its branch and automatic review are chosen at creation, as an errand's. */
export type PlanTaskInput = Endpoints['POST /api/projects/:projectId/plan-tasks']['body']
export const workApi = {
  retryPreparation: endpoint('POST /api/projects/:projectId/tasks/:taskId/retry-preparation'),
  changeBranch: endpoint('POST /api/projects/:projectId/tasks/:taskId/switch-branch'),
  list: (p: string) => api.get<Endpoints['GET /api/projects/:projectId/work']['response']>(root(p) + '/work'),
  attention: () => api.get<Endpoints['GET /api/work/attention']['response']>('/work/attention'),
  closeCheck: endpoint('GET /api/projects/:projectId/tasks/:taskId/close-check'),
  close: (p: string, t: string, discard = false) => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/close']['response']>(task(p, t) + '/close', { discard }),
  reopen: (p: string, t: string) => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/reopen']['response']>(task(p, t) + '/reopen', {}),
  cancel: (p: string, t: string, mode: 'keep' | 'discard') => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/cancel']['response']>(task(p, t) + '/cancel', { mode }),
  addPlan: (p: string, t: string) => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/add-plan']['response']>(task(p, t) + '/add-plan', {}),
  remove: (p: string, t: string, discard = false) => api.delete<Endpoints['DELETE /api/projects/:projectId/tasks/:taskId']['response']>(task(p, t) + (discard ? '?discard=1' : '')),
  errand: (p: string, body: ErrandInput) => tasksEndpoints.postProjectsByProjectIdErrands({ params: { projectId: p }, body }),
  planTask: (p: string, body: PlanTaskInput) => tasksEndpoints.postProjectsByProjectIdPlanTasks({ params: { projectId: p }, body }),
  errandFrom: (p: string, t: string, input: ErrandInput) => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/errand']['response']>(task(p, t) + '/errand', input),
  chat: (p: string, t: string, agent_id?: string, workspace?: string) => tasksEndpoints.postProjectsByProjectIdTasksByTaskIdChat({ params: { projectId: p, taskId: t }, body: { agent_id }, query: { workspace } }),
  review: (p: string, t: string, body: Endpoints['POST /api/projects/:projectId/tasks/:taskId/review']['body'] = {}, workspace?: string) => tasksEndpoints.reviewTask({ params: { projectId: p, taskId: t }, body, query: { workspace } }),
  check: (p: string, t: string, workspace?: string) => tasksEndpoints.checkTask({ params: { projectId: p, taskId: t }, query: { workspace } }),
  file: (p: string, t: string, file: string, workspace?: string) => tasksEndpoints.checkFile({ params: { projectId: p, taskId: t }, query: { file, workspace } }),
  send: (p: string, t: string, item_ids: string[], agent_id?: string, workspace?: string) => tasksEndpoints.sendCheck({ params: { projectId: p, taskId: t }, body: { item_ids, agent_id }, query: { workspace } }),
}
export const workspacesApi = {
  list: (p: string) => api.get<Endpoints['GET /api/projects/:projectId/workspaces']['response']>(root(p) + '/workspaces'),
  viewing: (p: string) => api.get<Endpoints['GET /api/projects/:projectId/workspaces/viewing']['response']>(root(p) + '/workspaces/viewing'),
  view: (p: string, workspaceId: string | null, confirmed = false) => api.put<Endpoints['PUT /api/projects/:projectId/workspaces/viewing']['response']>(root(p) + '/workspaces/viewing', { workspaceId, confirmed }),
  recreate: (p: string, w: string, discard = false) => api.post<Endpoints['POST /api/projects/:projectId/workspaces/:id/recreate']['response']>(root(p) + '/workspaces/' + encodeURIComponent(w) + '/recreate', { discard }),
}
export type ViewingWarnings = Endpoints['PUT /api/projects/:projectId/workspaces/viewing']['response']['warnings']
/** Architecture and QA documents of a task and the developer's marks of its preparation stages. */
export const preparationApi = {
  stages: (p: string, t: string) => api.get<Endpoints['GET /api/projects/:projectId/tasks/:taskId/preparation']['response']>(task(p, t) + '/preparation'),
  mark: (p: string, t: string, stage: PreparationStage, status: 'ready' | 'skipped') => api.post<Endpoints['POST /api/projects/:projectId/tasks/:taskId/preparation/:stage']['response']>(task(p, t) + '/preparation/' + stage, { status }),
  material: (p: string, t: string, type: MaterialType) => api.get<Endpoints['GET /api/projects/:projectId/tasks/:taskId/materials/:type']['response']>(task(p, t) + '/materials/' + type),
  save: (p: string, t: string, type: MaterialType, content: string, expected_version: number) => api.put<Endpoints['PUT /api/projects/:projectId/tasks/:taskId/materials/:type']['response']>(task(p, t) + '/materials/' + type, { content, expected_version }),
}

export const tasksEndpoints = {
  restart: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/restart'),
  skip: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/skip'),
  execute: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/execute'),
  complete: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/complete'),
  clearhistory: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/clear-history'),
  resume: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/resume'),
  pause: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/pause'),
  stop: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/stop'),
  start: endpoint('POST /api/projects/:projectId/tasks/:taskId/queue/start'),
  saveQueue: endpoint('PUT /api/projects/:projectId/tasks/:taskId/queue'),
  getQueue: endpoint('GET /api/projects/:projectId/tasks/:taskId/queue'),
  checkFile: endpoint('GET /api/projects/:projectId/tasks/:taskId/check/file'),
  sendCheck: endpoint('POST /api/projects/:projectId/tasks/:taskId/check/send'),
  reviewTask: endpoint('POST /api/projects/:projectId/tasks/:taskId/review'),
  checkTask: endpoint('GET /api/projects/:projectId/tasks/:taskId/check'),
  removeAnalysisFile: endpoint('DELETE /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files/:fileId'),
  removeAnalysis: endpoint('DELETE /api/projects/:projectId/tasks/:taskId/analysis/:sectionId'),
  uploadAnalysis: endpoint('POST /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files'),
  reorderAnalysis: endpoint('POST /api/projects/:projectId/tasks/:taskId/analysis/reorder'),
  updateAnalysis: endpoint('PATCH /api/projects/:projectId/tasks/:taskId/analysis/:sectionId'),
  createAnalysis: endpoint('POST /api/projects/:projectId/tasks/:taskId/analysis'),
  moveTask: endpoint('POST /api/projects/:projectId/tasks/:taskId/move'),
  listTasks: endpoint('GET /api/projects/:projectId/tasks'),
  postProjectsByProjectIdErrands: endpoint('POST /api/projects/:projectId/errands'),
  postProjectsByProjectIdPlanTasks: endpoint('POST /api/projects/:projectId/plan-tasks'),
  postProjectsByProjectIdTasksByTaskIdChat: endpoint('POST /api/projects/:projectId/tasks/:taskId/chat'),
  getProjectsByProjectIdTasksByTaskId: endpoint('GET /api/projects/:projectId/tasks/:taskId'),
  postProjectsByProjectIdTasks: endpoint('POST /api/projects/:projectId/tasks'),
  patchProjectsByProjectIdTasksByTaskIdPlansByPlanIdStepByStepIndex: endpoint('PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId/step/:stepIndex'),
  patchProjectsByProjectIdTasksByTaskId: endpoint('PATCH /api/projects/:projectId/tasks/:taskId'),
  postProjectsByProjectIdTasksByTaskIdBaseCommit: endpoint('POST /api/projects/:projectId/tasks/:taskId/base-commit'),
  postProjectsByProjectIdTasksByTaskIdRuns: endpoint('POST /api/projects/:projectId/tasks/:taskId/runs'),
  getQueuesBlocked: endpoint('GET /api/queues/blocked'),
  getProjectsByProjectIdTasksByTaskIdAnalysis: endpoint('GET /api/projects/:projectId/tasks/:taskId/analysis'),
  getProjectsByProjectIdTasksByTaskIdPlansLatest: endpoint('GET /api/projects/:projectId/tasks/:taskId/plans/latest'),
  postProjectsByProjectIdTasksByTaskIdDone: endpoint('POST /api/projects/:projectId/tasks/:taskId/done'),
  patchProjectsByProjectIdTasksByTaskIdPlansByPlanId: endpoint('PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId'),
  postProjectsByProjectIdTasksByTaskIdPlans: endpoint('POST /api/projects/:projectId/tasks/:taskId/plans'),
  getQueuesActive: endpoint('GET /api/queues/active'),
}
