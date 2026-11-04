import { endpoint } from '@core/api/endpoint'

export const terminalEndpoints = {
  getTerminalsRunning: endpoint('GET /api/terminals/running'),
  getTerminals: endpoint('GET /api/terminals'),
  postTerminals: endpoint('POST /api/terminals'),
  postTerminalsByIdByAction: endpoint('POST /api/terminals/:id/:action'),
  deleteTerminalsById: endpoint('DELETE /api/terminals/:id'),
  patchTerminalsById: endpoint('PATCH /api/terminals/:id'),
  getTerminalsShells: endpoint('GET /api/terminals/shells'),
}
