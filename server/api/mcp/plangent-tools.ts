import type { ToolCallUpdate } from '@agentclientprotocol/sdk';
import { tools as plangentTools } from './tools';
export { tools as plangentTools } from './tools';
export type { PlangentTool } from './tools';
const signatures = Object.entries(plangentTools).filter(([name]) => name !== 'git_action').map(([, t]) => Object.keys(t.fields).sort().join(','));

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
  if ('steps' in input && 'kind' in input && 'text' in input &&
    Object.keys(input).every(key => key in plangentTools.add_plan_remark.fields)) return true;
  if ('scope' in input && 'kind' in input && 'text' in input &&
    Object.keys(input).every(key => key in plangentTools.add_task_remark.fields)) return true;
  if ('command' in input && Object.keys(input).every(key => key in plangentTools.run_command.fields)) return true;
  if ('commandId' in input && Object.keys(input).every(key => key in plangentTools.command_output.fields)) return true;
  // A remark on the whole MR leaves out path, line and side.
  if ('text' in input &&
    Object.keys(input).every(key => key in plangentTools.add_review_remark.fields)) return true;
  return signatures.includes(Object.keys(input).sort().join(','));
}
