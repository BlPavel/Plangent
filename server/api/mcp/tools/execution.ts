import { stepContextFor } from '../../../core/execution/step-context';
import { taskContextFor } from '../../../core/work/task-context';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_step_context: { description: 'Get your assigned steps and the materials they refer to via [[...]]: analysis sections and files, the architecture and QA documents with the referenced decision and criterion ids. Call it before starting when the steps have references. A criterion shared with other steps is verified only after the last of them.', fields: {} },
get_task_context: { description: 'Get the task you follow up on: its goal, plan, analysis sections, the executors\' reports and the files changed since the task began. Call it when a remark needs that background; read the changes themselves with git.', fields: {} }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  if (name === 'get_task_context') return taskContextFor(session.task_id ?? '');
  return stepContextFor(session);
}
export const tools = defineTools(definitions, {
get_step_context: { roles: {"executor":0,"executor-readonly":0}, required: [], validateStrings: [] },
get_task_context: { roles: {"task-chat":8}, required: [], validateStrings: [] }
}, handle);
