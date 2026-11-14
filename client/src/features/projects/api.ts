import { endpoint } from '@core/api/endpoint'

export const projectsEndpoints = {
  postProjectsByIdDocsProbe: endpoint('POST /api/projects/:id/docs/probe'),
  postProjectsByIdDocsResolve: endpoint('POST /api/projects/:id/docs/resolve'),
  getProjectsByIdDocsPresets: async (input: Parameters<ReturnType<typeof endpoint<'GET /api/projects/:id/docs/presets'>>>[0]) => [...await endpoint('GET /api/projects/:id/docs/presets')(input)],
  postProjectsByIdDocsChildren: endpoint('POST /api/projects/:id/docs/children'),
  postProjectsByIdDocsSync: endpoint('POST /api/projects/:id/docs/sync'),
  postProjectsByIdDocsCancel: endpoint('POST /api/projects/:id/docs/cancel'),
  gitSettings: endpoint('GET /api/projects/:id/git-settings'),
  getProjectsByIdMentions: endpoint('GET /api/projects/:id/mentions'),
  postUploadTemp: endpoint('POST /api/upload-temp'),
  getBrowse: endpoint('GET /api/browse'),
  postProjectsCloneCancel: endpoint('POST /api/projects/clone-cancel'),
  postProjectsGitPreview: endpoint('POST /api/projects/git-preview'),
  getProjectsByIdHostMembers: endpoint('GET /api/projects/:id/host-members'),
  getProjects: endpoint('GET /api/projects'),
  postProjects: endpoint('POST /api/projects'),
  patchProjectsById: endpoint('PATCH /api/projects/:id'),
  deleteProjectsById: endpoint('DELETE /api/projects/:id'),
  getProjectsGitDefaults: endpoint('GET /api/projects/git-defaults'),
  putProjectsGitDefaults: endpoint('PUT /api/projects/git-defaults'),
}
