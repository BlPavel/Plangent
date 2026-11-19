import { endpoint } from '@core/api/endpoint'

export const settingsEndpoints = {
  getAgentProxy: endpoint('GET /api/settings/agent-proxy'),
  putAgentProxy: endpoint('PUT /api/settings/agent-proxy'),
  checkAgentProxy: endpoint('POST /api/settings/agent-proxy/check'),
  savePassword: (kind: string, id: string, password: string) => {
    if (kind === 'connections') return settingsEndpoints.putIntegrationsConnectionsByIdPassword({ params: { id }, body: { password } })
    if (kind === 'credentials') return settingsEndpoints.putIntegrationsCredentialsByIdPassword({ params: { id }, body: { password } })
    throw new Error(`Unknown password target: ${kind}`)
  },
  getHealth: endpoint('GET /api/health'),
  getIntegrationsConnections: endpoint('GET /api/integrations/connections'),
  getIntegrationsOrganizations: endpoint('GET /api/integrations/organizations'),
  getIntegrationsConnectionsById: endpoint('GET /api/integrations/connections/:id'),
  postIntegrationsConnectionsByIdCheck: endpoint('POST /api/integrations/connections/:id/check'),
  getIntegrationsConnectionsByIdCredential: endpoint('GET /api/integrations/connections/:id/credential'),
  postIntegrationsNormalizeUrl: endpoint('POST /api/integrations/normalize-url'),
  patchIntegrationsConnectionsById: endpoint('PATCH /api/integrations/connections/:id'),
  postIntegrationsConnections: endpoint('POST /api/integrations/connections'),
  putIntegrationsConnectionsByIdPassword: endpoint('PUT /api/integrations/connections/:id/password'),
  getIntegrationsCredentials: endpoint('GET /api/integrations/credentials'),
  getIntegrationsPresets: async (input: Parameters<ReturnType<typeof endpoint<'GET /api/integrations/presets'>>>[0]) => [...await endpoint('GET /api/integrations/presets')(input)],
  getIntegrationsStorage: endpoint('GET /api/integrations/storage'),
  patchIntegrationsOrganizationsById: endpoint('PATCH /api/integrations/organizations/:id'),
  postIntegrationsOrganizations: endpoint('POST /api/integrations/organizations'),
  patchIntegrationsCredentialsById: endpoint('PATCH /api/integrations/credentials/:id'),
  postIntegrationsCredentials: endpoint('POST /api/integrations/credentials'),
  putIntegrationsCredentialsByIdPassword: endpoint('PUT /api/integrations/credentials/:id/password'),
  deleteIntegrationsOrganizationsById: endpoint('DELETE /api/integrations/organizations/:id'),
  deleteIntegrationsCredentialsById: endpoint('DELETE /api/integrations/credentials/:id'),
  deleteIntegrationsConnectionsById: endpoint('DELETE /api/integrations/connections/:id'),
  putSettingsByKey: endpoint('PUT /api/settings/:key'),
  getSettingsByKey: endpoint('GET /api/settings/:key'),
}
