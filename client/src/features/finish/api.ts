import { api } from '@core/api'
import type { FinishRun, FinishOptions, FinishCommit, FinishContext } from './types'
const root = (p: string) => '/projects/' + encodeURIComponent(p) + '/finish'
const run = (p: string, r: string) => root(p) + '/' + encodeURIComponent(r)
export const finishApi = {
 active: (p: string) => api.get<FinishRun | null>(root(p)),
 get: (p: string, r: string) => api.get<FinishRun>(run(p, r)),
 start: (p: string, options: FinishOptions) => api.post<FinishRun | null>(root(p), options),
 context: (p: string, r: string) => api.get<FinishContext>(run(p, r) + '/context'),
 commits: (p: string, r: string, commits: FinishCommit[]) => api.put<FinishRun>(run(p, r) + '/commits', { commits }),
 action: (p: string, r: string, action: string, data: object = {}) => api.post<FinishRun>(run(p, r) + '/' + action, data),
}
