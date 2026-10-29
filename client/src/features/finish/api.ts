import { workspaceApi } from '@core/api'
import type { FinishRun, FinishOptions, FinishCommit, FinishContext, MrDraft } from './types'
const root = (p: string) => '/projects/' + encodeURIComponent(p) + '/finish'
const run = (p: string, r: string) => root(p) + '/' + encodeURIComponent(r)
export const finishApi = {
 active: (p: string, workspaceId?: string) => workspaceApi(workspaceId).get<FinishRun | null>(root(p)),
 get: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).get<FinishRun>(run(p, r)),
 start: (p: string, options: FinishOptions, workspaceId?: string) => workspaceApi(workspaceId).post<FinishRun | null>(root(p), options),
 context: (p: string, r: string, workspaceId?: string) => workspaceApi(workspaceId).get<FinishContext>(run(p, r) + '/context'),
 commits: (p: string, r: string, commits: FinishCommit[], workspaceId?: string) => workspaceApi(workspaceId).put<FinishRun>(run(p, r) + '/commits', { commits }),
 mergeRequest: (p: string, r: string, draft: MrDraft, workspaceId?: string) => workspaceApi(workspaceId).put<FinishRun>(run(p, r) + '/merge-request', draft),
 action: (p: string, r: string, action: string, data: object = {}, workspaceId?: string) => workspaceApi(workspaceId).post<FinishRun>(run(p, r) + '/' + action, data),
}
