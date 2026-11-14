import { interviewGuide, interviewRound } from '../../../core/library';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const option = { type: 'object', additionalProperties: false, required: ['label'], properties: {
  label: { type: 'string', description: 'Short answer the developer can pick.' },
  detail: { type: 'string', description: 'Consequences of this choice, one or two sentences.' },
  recommended: { type: 'boolean', description: 'Your recommendation; at most one per question.' },
} };
const question = { type: 'object', additionalProperties: false, required: ['text', 'options'], properties: {
  id: { type: 'string', description: 'Stable id; reuse it when you ask a question again after a clarification request.' },
  text: { type: 'string', description: 'The question itself, one decision.' },
  context: { type: 'string', description: 'Why it matters or what it depends on.' },
  options: { type: 'array', minItems: 2, maxItems: 4, items: option },
} };
const definitions = {
get_interview_guide: { description: 'Read the current Plangent interview rules and the focus of this section. Call only when the developer explicitly requests an interview. Save answers with your role’s existing tools.', fields: {} },
ask_interview_questions: {
    description: 'Show the developer one round of interview questions as a card with options. The developer can also answer in their own words or ask to clarify a question. Call once per turn, then end your turn: the answers arrive as the next message.',
    fields: {
      round: { type: 'integer', minimum: 1, description: 'Number of this round, from 1.' },
      total_rounds: { type: 'integer', minimum: 1, description: 'Your current estimate of all rounds; it may change as answers arrive.' },
      topic: { type: 'string', description: 'What this round decides, a few words.' },
      questions: { type: 'array', minItems: 1, maxItems: 6, items: question },
      upcoming: { type: 'array', items: { type: 'string' }, description: 'Short topics of the following rounds.' },
    },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  if (name === 'get_interview_guide') return interviewGuide(session);
  const round = interviewRound(session, args);
  emit('interview_questions', { ...round });
  return { shown: true, next: 'End your turn now. The developer’s answers arrive as the next message. Do not do the requested work before the interview ends.' };
}
export const tools = defineTools(definitions, {
get_interview_guide: { roles: {"analyst":0,"material-author":0,"planner":0}, required: [], validateStrings: [] },
ask_interview_questions: { roles: {"analyst":5,"material-author":5,"planner":5}, required: ["round","total_rounds","questions"], validateStrings: [] }
}, handle);
