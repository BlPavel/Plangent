import type { Endpoints } from '@contracts'
import { endpoint } from '@core/api/endpoint'
import { workspaceApi } from '@core/api'
import type { FinishOptions, FinishCommit, MrDraft } from './types'
const root = (p: string) => '/projects/' + encodeURIComponent(p) + '/finish'
const run = (p: string, r: string) => root(p) + '/' + encodeURIComponent(r)
export const finishApi = {
 active: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/finish']['response']>(root(p)),
 get: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/finish/:id']['response']>(run(p, r)),
 start: (p: string, options: FinishOptions, workspaceId?: string) => workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/finish']['response']>(root(p), options),
 context: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).get<Endpoints['GET /api/projects/:projectId/finish/:id/context']['response']>(run(p, r) + '/context'),
 commits: (p: string, r: string, commits: FinishCommit[], workspaceId?: string, skipHooks?: boolean) => workspaceApi(workspaceId).put<Endpoints['PUT /api/projects/:projectId/finish/:id/commits']['response']>(run(p, r) + '/commits', { commits, ...(skipHooks ? { skipHooks } : {}) }),
 mergeRequest: (p: string, r: string, draft: MrDraft, workspaceId?: string) => workspaceApi(workspaceId).put<Endpoints['PUT /api/projects/:projectId/finish/:id/merge-request']['response']>(run(p, r) + '/merge-request', draft),
 action: async (p: string, r: string, action: string, data: object = {}, workspaceId?: string) => {
  switch (action) {
   case 'accept': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/finish/:id/accept']['response']>(run(p, r) + '/accept', data)
   case 'revise': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/finish/:id/revise']['response']>(run(p, r) + '/revise', data)
   case 'rollback': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/finish/:id/rollback']['response']>(run(p, r) + '/rollback', data)
   case 'cancel': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/finish/:id/cancel']['response']>(run(p, r) + '/cancel', data)
   case 'adopt-hook-changes': return workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/finish/:id/adopt-hook-changes']['response']>(run(p, r) + '/adopt-hook-changes', data)
   case 'cancel-operation': await workspaceApi(workspaceId).post<Endpoints['POST /api/projects/:projectId/finish/:id/cancel-operation']['response']>(run(p, r) + '/cancel-operation'); return finishApi.get(p, r, workspaceId)
   default: throw new Error('Unknown finish action: ' + action)
  }
 },
}

export const finishEndpoints = {
  getProjectsByProjectIdFinishTaskByTaskId: endpoint('GET /api/projects/:projectId/finish/task/:taskId'),
}
