import { DEFAULT_INTERVIEW_INSTRUCTION } from './builtins';
export { DEFAULT_INTERVIEW_INSTRUCTION } from './builtins';
import { resolveGlobalText } from './section-settings';
import type { AgentSession } from '../agents';



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
