import { DEFAULT_INTERVIEW_INSTRUCTION } from './builtins';
export { DEFAULT_INTERVIEW_INSTRUCTION } from './builtins';
import { resolveGlobalText } from './section-settings';
import type { AgentSession } from '../agents';
import type { InterviewAnswersMeta, InterviewOption, InterviewQuestion } from '../../models';

export interface InterviewRound { round: number; total_rounds: number; topic?: string; questions: InterviewQuestion[]; upcoming?: string[] }



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
  return { instruction: resolveGlobalText('interview-instruction', DEFAULT_INTERVIEW_INSTRUCTION), ...interviewFocus(session), ask: 'ask_interview_questions' };
}

interface SessionEvent { seq: number; type: string; payload: { content?: unknown; round?: number; total_rounds?: number } }
function answersTo(event: SessionEvent) {
  if (event.type !== 'user' || !Array.isArray(event.payload.content)) return null;
  for (const block of event.payload.content as { _meta?: Partial<InterviewAnswersMeta> | null }[]) if (block?._meta?.plangent_interview) return block._meta.plangent_interview;
  return null;
}

/**
 * Why the section must not be saved yet: the interview started and is not over. It is over after the answers to a
 * round numbered total_rounds with nothing to clarify, or when the developer ended it.
 */
export function interviewPending(events: SessionEvent[]): string | null {
  const last = [...events].reverse().find(e => e.type === 'interview_questions');
  if (!last) return null;
  const answers = events.filter(e => e.seq > last.seq).map(answersTo).find(meta => meta?.round_seq === last.seq);
  if (!answers) return `The interview is in progress: wait for the developer's answers to round ${last.payload.round}.`;
  if (answers.finish) return null;
  if (answers.answers.some(a => a.kind === 'clarify')) return 'The interview is in progress: ask the questions the developer asked to clarify in the next round with ask_interview_questions.';
  if (Number(last.payload.round) < Number(last.payload.total_rounds)) return `The interview is in progress: ask round ${Number(last.payload.round) + 1} of ${last.payload.total_rounds} with ask_interview_questions.`;
  return null;
}

/** The section's save tool waits until the interview is over, whatever the developer's original wish was. */
export function interviewBlocksTool(session: AgentSession, tool: string, events: () => SessionEvent[]): string | null {
  let save: string;
  try { save = interviewFocus(session).save; } catch { return null; }
  const pending = tool === save ? interviewPending(events()) : null;
  return pending && pending + ` Do not call ${save} or do the requested work before the interview ends.`;
}

const MAX_QUESTIONS = 6, MAX_OPTIONS = 4;
function text(value: unknown, field: string, max: number): string;
function text(value: unknown, field: string, max: number, optional: true): string | undefined;
function text(value: unknown, field: string, max: number, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
  if (value.length > max) throw new Error(`${field} is longer than ${max} characters`);
  return value.trim();
}
function count(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 50) throw new Error(`Invalid ${field}`);
  return Number(value);
}

/** Checks one round of interview questions; the client renders it as a card the developer answers. */
export function interviewRound(session: AgentSession, args: Record<string, unknown>): InterviewRound {
  interviewFocus(session);
  const round = count(args.round, 'round'), total = count(args.total_rounds, 'total_rounds');
  if (round > total) throw new Error('round is greater than total_rounds');
  if (!Array.isArray(args.questions) || !args.questions.length || args.questions.length > MAX_QUESTIONS) throw new Error(`Ask 1–${MAX_QUESTIONS} questions in a round`);
  const ids = new Set<string>();
  const questions = args.questions.map((raw: Record<string, unknown>, q): InterviewQuestion => {
    const field = `questions[${q}]`;
    if (!raw || typeof raw !== 'object') throw new Error(`Invalid ${field}`);
    const id = raw.id === undefined ? `q${q + 1}` : text(raw.id, `${field}.id`, 60);
    if (ids.has(id)) throw new Error(`Duplicate question id ${id}`);
    ids.add(id);
    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > MAX_OPTIONS) throw new Error(`${field}: give 2–${MAX_OPTIONS} options; the developer can always answer in their own words`);
    const options = raw.options.map((option: Record<string, unknown>, o): InterviewOption => {
      if (!option || typeof option !== 'object') throw new Error(`Invalid ${field}.options[${o}]`);
      const detail = text(option.detail, `${field}.options[${o}].detail`, 1000, true);
      return { label: text(option.label, `${field}.options[${o}].label`, 300), ...(detail ? { detail } : {}), ...(option.recommended === true ? { recommended: true } : {}) };
    });
    if (options.filter(o => o.recommended).length > 1) throw new Error(`${field}: recommend at most one option`);
    const context = text(raw.context, `${field}.context`, 2000, true);
    return { id, text: text(raw.text, `${field}.text`, 1000), ...(context ? { context } : {}), options };
  });
  const topic = text(args.topic, 'topic', 200, true);
  const upcoming = Array.isArray(args.upcoming) ? args.upcoming.slice(0, 20).map((item, i) => text(item, `upcoming[${i}]`, 200)) : [];
  return { round, total_rounds: total, ...(topic ? { topic } : {}), questions, ...(upcoming.length ? { upcoming } : {}) };
}
