import { resolveGlobalText } from './section-settings';
import type { AgentSession } from '../agent-sessions/types';

export const DEFAULT_INTERVIEW_INSTRUCTION = `# Plangent clarification interview
The developer explicitly requested an interview. Ask questions in the language of the conversation.
1. Read the section's current materials with your own context tool and inspect relevant project rules and code yourself. Ask about choices, not facts you can discover. Use reference sources only when explicitly mentioned by the developer.
2. Identify unresolved decisions and their dependencies. Ask small rounds (usually 1–3 questions), starting with choices whose prerequisites are already settled.
3. Offer concrete options with consequences and a reasoned recommendation. Do not present your proposals as accepted requirements. Wait for the developer's answers before resolving dependent choices.
4. Record answers in your section using its existing save tools. Preserve distinctions between facts, proposals, accepted decisions and unresolved questions. Do not create a separate interview specification or duplicate other materials.
5. The developer may stop or narrow the interview at any time. Leave unanswered questions visible in the section. Exhausting every branch is not required.
6. Never mark a preparation stage ready or skipped; only the developer does that.`;

export function interviewFocus(session: AgentSession): { section: string; focus: string; read: string; save: string } {
  if (session.role === 'analyst') return { section: 'analysis', focus: 'Requirements, goals, scope, constraints and unknowns.', read: 'get_analysis', save: 'save_section' };
  if (session.role === 'planner') return { section: 'plan', focus: 'Implementation alternatives, dependencies, executable order and completion checks.', read: 'get_plan', save: 'submit_plan' };
  if (session.role === 'material-author' && session.metadata.material_type === 'architecture')
    return { section: 'architecture', focus: 'Architecture decisions and tradeoffs: responsibility, boundaries, interactions, state ownership, contracts, failures and concurrency where relevant.', read: 'get_material', save: 'submit_material' };
  if (session.role === 'material-author' && session.metadata.material_type === 'qa')
    return { section: 'qa', focus: 'Observable behaviour, acceptance criteria, boundaries, errors and ambiguities. Keep expected results separate from verification methods; never invent requirements.', read: 'get_material', save: 'submit_material' };
  throw new Error('Interview is not available for this session');
}

export function interviewGuide(session: AgentSession) {
  return { instruction: resolveGlobalText('interview-instruction', DEFAULT_INTERVIEW_INSTRUCTION), ...interviewFocus(session) };
}
