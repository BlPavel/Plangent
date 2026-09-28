import type { ToolCallUpdate } from '@agentclientprotocol/sdk';

/** Tools the Plangent MCP server gives agents (served by infrastructure/mcp/server.ts). */
export const plangentTools = {
  complete_step: { description: 'Finish all assigned steps with a summary.', fields: { summary: { type: 'string' } } },
  request_help: { description: 'Ask the developer for help.', fields: { question: { type: 'string' } } },
  report_progress: { description: 'Report progress.', fields: { note: { type: 'string' } } },
  get_review_context: { description: 'Get assigned plan and executor context.', fields: {} },
  add_finding: { description: 'Report a review finding.', fields: { file: { type: 'string' }, line: { type: 'integer', minimum: 1 }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, message: { type: 'string' } } },
  submit_review: { description: 'Submit review verdict.', fields: { verdict: { type: 'string', enum: ['approved', 'changes_requested'] } } },
};
export type PlangentTool = keyof typeof plangentTools;

const signatures = Object.values(plangentTools).map(t => Object.keys(t.fields).sort().join(','));

/**
 * Whether a permission request is for one of Plangent's own tools. The MCP server already checks the
 * session's role, so asking the developer about them (or denying them to a read-only reviewer) only
 * stalls the queue. Some agents name the tool (`mcp__plangent__complete_step`); Gemini-family agents
 * (GigaCode, Qwen) send just the arguments, with the title being those arguments as JSON.
 */
export function isPlangentToolCall(tool: Pick<ToolCallUpdate, 'title' | 'kind' | 'rawInput'>): boolean {
  const title = tool.title ?? '';
  if (/plangent/i.test(title) && Object.keys(plangentTools).some(name => title.includes(name))) return true;
  const input = tool.rawInput;
  if ((tool.kind ?? 'other') !== 'other' || !input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (title !== JSON.stringify(input)) return false;
  return signatures.includes(Object.keys(input).sort().join(','));
}
