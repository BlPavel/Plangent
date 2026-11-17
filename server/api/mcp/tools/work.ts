import { completeAgentWork, requestAgentHelp } from '../../../core/agents';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
complete_step: { description: 'Finish all assigned steps once with a summary. After completion, continue follow-up work and discussions without calling this tool again.', fields: { summary: { type: 'string' } } },
request_help: { description: 'Ask the developer for help.', fields: { question: { type: 'string' } } },
report_progress: { description: 'Report progress.', fields: { note: { type: 'string' } } }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  if (name === 'complete_step' && !completeAgentWork(id, String(args.summary))) {
    return { ok: true, already_completed: true, message: 'The work was already completed. Continue follow-up work normally; do not call complete_step again.' };
  }
if (name === 'request_help') requestAgentHelp(id, String(args.question));
emit(name, args);
return { ok: true };
}
export const tools = defineTools(definitions, {
complete_step: { roles: {"errand":0,"executor":1}, required: ["summary"], validateStrings: ["summary"] },
request_help: { roles: {"task-reviewer":3,"errand":1,"task-chat":0,"executor":2,"executor-readonly":1}, required: ["question"], validateStrings: ["question"] },
report_progress: { roles: {"task-reviewer":4,"errand":2,"task-chat":1,"executor":3,"executor-readonly":2}, required: ["note"], validateStrings: ["note"] }
}, handle);
