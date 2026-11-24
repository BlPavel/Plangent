
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
import { planTask, planResult } from './context';
const definitions = {
get_plan: { description: 'Get the task, current plan, preparation materials, template and planning instructions. Call it before writing or revising the implementation plan.', fields: {} },
submit_plan: {
    description: 'Save the whole plan (markdown). Every tracked step is its own line "- [ ] step text"; everything else (headings, notes) is free text. ' +
      'Keep existing "(pN)" ids of steps you keep; leave ids out for new steps - Plangent numbers them. Call again with the full plan after every change.',
    fields: { content: { type: 'string' } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = planResult(name, session, args);
if (name === 'submit_plan') emit(name, { summary: `План сохранён: шагов — ${(result as { steps: string[] }).steps.length}` });
return result;
}
export const tools = defineTools(definitions, {
get_plan: { roles: {"planner":1}, required: [], validateStrings: [] },
submit_plan: { roles: {"planner":2}, required: ["content"], validateStrings: ["content"] }
}, handle);
