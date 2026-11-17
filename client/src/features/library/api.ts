import { endpoint } from '@core/api/endpoint'

const defaults = {
  'instruction-guide': endpoint('GET /api/library/instruction-guide/defaults'),
  'code-fixer-instruction': endpoint('GET /api/library/code-fixer-instruction/defaults'),
  'commit-rules': endpoint('GET /api/library/commit-rules/defaults'),
  'mr-rules': endpoint('GET /api/library/mr-rules/defaults'),
  'plan-review-instruction': endpoint('GET /api/library/plan-review-instruction/defaults'),
  'mr-review-instruction': endpoint('GET /api/library/mr-review-instruction/defaults'),
  'architecture-review-instruction': endpoint('GET /api/library/architecture-review-instruction/defaults'),
  'qa-review-instruction': endpoint('GET /api/library/qa-review-instruction/defaults'),
  'interview-instruction': endpoint('GET /api/library/interview-instruction/defaults'),
  'plan-template': endpoint('GET /api/library/plan-template/defaults'),
  'architecture-template': endpoint('GET /api/library/architecture-template/defaults'),
  'qa-template': endpoint('GET /api/library/qa-template/defaults'),
}
export async function libraryDefaults(type: keyof typeof defaults) {
  const value = await defaults[type]({ params: {} })
  return { ...value, content: 'content' in value ? value.content : '', lockedProtocol: 'lockedProtocol' in value ? value.lockedProtocol : '' }
}

export const libraryEndpoints = {
  getInstructionText: endpoint('GET /api/library/instruction-text'),
  getLibrary: endpoint('GET /api/library'),
  putLibraryById: endpoint('PUT /api/library/:id'),
  postLibrary: endpoint('POST /api/library'),
  getLibraryById: endpoint('GET /api/library/:id'),
  deleteLibraryById: endpoint('DELETE /api/library/:id'),
  postLibraryByIdDetach: endpoint('POST /api/library/:id/detach'),
  postLibraryByIdExclude: endpoint('POST /api/library/:id/exclude'),
  postLibrarySync: endpoint('POST /api/library/sync'),
  getLibraryPlanTemplateDefaults: defaults['plan-template'],
  getLibraryByIdOverridesByAgentType: endpoint('GET /api/library/:id/overrides/:agentType'),
  putLibraryByIdOverridesByAgentType: endpoint('PUT /api/library/:id/overrides/:agentType'),
  deleteLibraryByIdOverridesByAgentType: endpoint('DELETE /api/library/:id/overrides/:agentType'),
  getLibraryProposals: endpoint('GET /api/library/proposals'),
  postLibraryProposalsByProposalIdApply: endpoint('POST /api/library/proposals/:proposalId/apply'),
  postLibraryProposalsByProposalIdReject: endpoint('POST /api/library/proposals/:proposalId/reject'),
  getLibraryInstructionGuideDefaults: defaults['instruction-guide'],
  getLibraryCodeFixerInstructionDefaults: defaults['code-fixer-instruction'],
}
