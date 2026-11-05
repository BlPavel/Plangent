import { interviewGuide } from '../../../core/library/interview-instruction';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_interview_guide: { description: 'Read the current Plangent interview rules and the focus of this section. Call only when the developer explicitly requests an interview. Save answers with your role’s existing tools.', fields: {} }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  return interviewGuide(session);
}
export const tools = defineTools(definitions, {
get_interview_guide: { roles: {"analyst":0,"material-author":0,"planner":0}, required: [], validateStrings: [] }
}, handle);
