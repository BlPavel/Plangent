import type { Endpoints } from '@contracts'
import { endpoint } from '@core/api/endpoint'
import { api } from '@core/api'

const base = (scope: string) => '/projects/' + encodeURIComponent(scope) + '/mr-review';
const review = (scope: string, id: string) => base(scope) + '/' + encodeURIComponent(id);
export const mrReviewApi = {
  list: (scope: string, q?: string) => api.get<Endpoints['GET /api/projects/:projectId/mr-review']['response']>(base(scope) + (q === undefined ? '' : '?q=' + encodeURIComponent(q))),
  open: (scope: string, input: {
    url?: string;
    project_id?: string;
    iid?: number;
  }) => api.post<Endpoints['POST /api/projects/:projectId/mr-review/open']['response']>(base(scope) + '/open', input),
  detail: (scope: string, id: string) => api.get<Endpoints['GET /api/projects/:projectId/mr-review/:id']['response']>(review(scope, id)),
  refresh: (scope: string, id: string, version?: number) => api.post<Endpoints['POST /api/projects/:projectId/mr-review/:id/refresh']['response']>(review(scope, id) + '/refresh', { version }),
  file: (scope: string, id: string, path: string, head?: string, signal?: AbortSignal) => api.get<Endpoints['GET /api/projects/:projectId/mr-review/:id/file']['response']>(review(scope, id) + '/file?path=' + encodeURIComponent(path) + (head ? '&head=' + encodeURIComponent(head) : ''), signal),
  add: (scope: string, id: string, note: {
    body: string;
    path?: string;
    side?: 'old' | 'new';
    line?: number;
    head?: string;
  }) => api.post<Endpoints['POST /api/projects/:projectId/mr-review/:id/drafts']['response']>(review(scope, id) + '/drafts', note),
  edit: (scope: string, id: string, draft: string, body: string) => api.patch<Endpoints['PATCH /api/projects/:projectId/mr-review/:id/drafts/:draft']['response']>(review(scope, id) + '/drafts/' + encodeURIComponent(draft), { body }),
  remove: (scope: string, id: string, draft: string) => api.delete<Endpoints['DELETE /api/projects/:projectId/mr-review/:id/drafts/:draft']['response']>(review(scope, id) + '/drafts/' + encodeURIComponent(draft)),
  recover: (scope: string, id: string, draft: string, published: boolean) => api.post<Endpoints['POST /api/projects/:projectId/mr-review/:id/drafts/:draft/recover']['response']>(review(scope, id) + '/drafts/' + encodeURIComponent(draft) + '/recover', { published, confirmed: true }),
  publish: (scope: string, id: string, ids: string[]) => api.post<Endpoints['POST /api/projects/:projectId/mr-review/:id/publish']['response']>(review(scope, id) + '/publish', { ids, confirmed: true }),
  reply: (scope: string, id: string, discussion: string, body: string) => api.post<Endpoints['POST /api/projects/:projectId/mr-review/:id/discussions/:discussion/reply']['response']>(review(scope, id) + '/discussions/' + encodeURIComponent(discussion) + '/reply', { body }),
  approve: (scope: string, id: string, approved: boolean) => api.post<Endpoints['POST /api/projects/:projectId/mr-review/:id/approve']['response']>(review(scope, id) + '/approve', { approved }),
  viewed: (scope: string, id: string, path: string, viewed: boolean) => api.put<Endpoints['PUT /api/projects/:projectId/mr-review/:id/viewed']['response']>(review(scope, id) + '/viewed', { path, viewed }),
};

export const privateThreads = endpoint('GET /api/projects/:projectId/mr-review/:id/threads')

export const createPrivateThread = endpoint('POST /api/projects/:projectId/mr-review/:id/threads')

export const finishPrivate = endpoint('POST /api/projects/:projectId/mr-review/:id/finish')
