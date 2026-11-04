import { endpoint } from '@core/api/endpoint'
import type { PermissionPolicy, AgentOptionsSource } from '@contracts'

export function permissionPolicy(value: string): PermissionPolicy {
  if (value === 'ask' || value === 'allow-edits' || value === 'allow-all' || value === 'read-only') return value
  throw new Error(`Unknown permission policy: ${value}`)
}

export const agentsApi = {
  list: endpoint('GET /api/agents'),
  get: endpoint('GET /api/agents/:id'),
  create: endpoint('POST /api/agents'),
  update: endpoint('PATCH /api/agents/:id'),
  remove: endpoint('DELETE /api/agents/:id'),
  presets: endpoint('GET /api/agents/presets'),
  limits: endpoint('GET /api/agents/:id/limits'),
  options: async (input: Parameters<ReturnType<typeof endpoint<'GET /api/agents/:id/acp-options'>>>[0]) => {
    const value = await endpoint('GET /api/agents/:id/acp-options')(input)
    return value && { ...value, models: value.models as AgentOptionsSource['models'] }
  },
  upgrade: endpoint('POST /api/agents/:id/update'),
}

export const agentsEndpoints = {
  postAgentsByIdUpdate: agentsApi.upgrade,
  getAgentsPresets: agentsApi.presets,
}
