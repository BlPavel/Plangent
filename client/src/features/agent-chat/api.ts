import { endpoint } from '@core/api/endpoint'

export const agentChatEndpoints = {
  postAgentSessions: endpoint('POST /api/agent-sessions'),
  patchAgentSessionsById: endpoint('PATCH /api/agent-sessions/:id'),
  postAgentSessionsByIdByAction: endpoint('POST /api/agent-sessions/:id/:action'),
  deleteAgentSessionsByIdQueueByPromptId: endpoint('DELETE /api/agent-sessions/:id/queue/:promptId'),
  getAgentSessionsById: endpoint('GET /api/agent-sessions/:id'),
  deleteAgentSessionsById: endpoint('DELETE /api/agent-sessions/:id'),
  getAgentSessions: endpoint('GET /api/agent-sessions'),
}
