import { stepContextFor } from '../../../core/execution/step-context';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_step_context: { description: 'Get your assigned steps and the materials they refer to via [[...]]: analysis sections and files, the architecture and QA documents with the referenced decision and criterion ids. Call it before starting when the steps have references. A criterion shared with other steps is verified only after the last of them.', fields: {} }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  return stepContextFor(session);
}
export const tools = defineTools(definitions, {
get_step_context: { roles: {"executor":0,"executor-readonly":0}, required: [], validateStrings: [] }
}, handle);
