import type { ToolCallUpdate } from '@agentclientprotocol/sdk';

/** Tools the Plangent MCP server gives agents (served by infrastructure/mcp/server.ts). */
export const plangentTools = {
  complete_step: { description: 'Finish all assigned steps with a summary.', fields: { summary: { type: 'string' } } },
  request_help: { description: 'Ask the developer for help.', fields: { question: { type: 'string' } } },
  report_progress: { description: 'Report progress.', fields: { note: { type: 'string' } } },
  get_review_context: { description: 'Get assigned plan and executor context.', fields: {} },
  add_finding: { description: 'Report a review finding.', fields: { file: { type: 'string' }, line: { type: 'integer', minimum: 1 }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, message: { type: 'string' } } },
  submit_review: { description: 'Submit review verdict.', fields: { verdict: { type: 'string', enum: ['approved', 'changes_requested'] } } },
  get_analysis: { description: 'Get analysis sections, descriptions and attachment paths. Call before analyzing.', fields: {} },
  save_section: {
    description: 'Save an analysis section. Omit slug to create; supply existing slug to update. Defaults to worked, author agent. Source or developer material edits require an explicit developer request and source_requested=true.',
    fields: { title: { type: 'string' }, description: { type: 'string' }, slug: { type: 'string' },
      kind: { type: 'string', enum: ['source', 'worked'] }, source_requested: { type: 'boolean' } },
  },
  get_plan: { description: 'Get the task, its current plan (if any), the plan template and the plan format rules. Call it before writing a plan.', fields: {} },
  submit_plan: {
    description: 'Save the whole plan (markdown). Every tracked step is its own line "- [ ] step text"; everything else (headings, notes) is free text. ' +
      'Keep existing "(pN)" ids of steps you keep; leave ids out for new steps - Plangent numbers them. Call again with the full plan after every change.',
    fields: { content: { type: 'string' } },
  },
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
  // Codex: { server: 'plangent', tool: 'submit_plan', arguments: {...} }
  const mcp = input as { server?: unknown; tool?: unknown } | undefined;
  if (mcp?.server === 'plangent' && typeof mcp.tool === 'string' && mcp.tool in plangentTools) return true;
  if ((tool.kind ?? 'other') !== 'other' || !input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (title !== JSON.stringify(input)) return false;
  if ('title' in input && 'description' in input &&
    Object.keys(input).every(key => key in plangentTools.save_section.fields)) return true;
  return signatures.includes(Object.keys(input).sort().join(','));
}
