import { api } from '@core/api';
import type { MrDetail, MrDraft, ReviewRequest } from './types';
const base = (scope: string) => '/projects/' + encodeURIComponent(scope) + '/mr-review';
const review = (scope: string, id: string) => base(scope) + '/' + encodeURIComponent(id);
export const mrReviewApi = {
  list: (scope: string, q?: string) => api.get<{
    requests: ReviewRequest[];
    errors: {
      project_id: string;
      message: string;
    }[];
  }>(base(scope) + (q === undefined ? '' : '?q=' + encodeURIComponent(q))),
  open: (scope: string, input: {
    url?: string;
    project_id?: string;
    iid?: number;
  }) => api.post<MrDetail>(base(scope) + '/open', input),
  detail: (scope: string, id: string) => api.get<MrDetail>(review(scope, id)),
  refresh: (scope: string, id: string, version?: number) => api.post<MrDetail>(review(scope, id) + '/refresh', { version }),
  file: (scope: string, id: string, path: string, head?: string, signal?: AbortSignal) => api.get<{
    content: string;
  }>(review(scope, id) + '/file?path=' + encodeURIComponent(path) + (head ? '&head=' + encodeURIComponent(head) : ''), signal),
  add: (scope: string, id: string, note: {
    body: string;
    path?: string;
    side?: 'old' | 'new';
    line?: number;
    head?: string;
  }) => api.post<MrDraft>(review(scope, id) + '/drafts', note),
  edit: (scope: string, id: string, draft: string, body: string) => api.patch<MrDetail>(review(scope, id) + '/drafts/' + encodeURIComponent(draft), { body }),
  remove: (scope: string, id: string, draft: string) => api.delete<MrDetail>(review(scope, id) + '/drafts/' + encodeURIComponent(draft)),
  recover: (scope: string, id: string, draft: string, published: boolean) => api.post<MrDetail>(review(scope, id) + '/drafts/' + encodeURIComponent(draft) + '/recover', { published, confirmed: true }),
  publish: (scope: string, id: string, ids: string[]) => api.post<MrDetail>(review(scope, id) + '/publish', { ids, confirmed: true }),
  reply: (scope: string, id: string, discussion: string, body: string) => api.post<MrDetail>(review(scope, id) + '/discussions/' + encodeURIComponent(discussion) + '/reply', { body }),
  approve: (scope: string, id: string, approved: boolean) => api.post<MrDetail>(review(scope, id) + '/approve', { approved }),
  viewed: (scope: string, id: string, path: string, viewed: boolean) => api.put<MrDetail>(review(scope, id) + '/viewed', { path, viewed }),
};
