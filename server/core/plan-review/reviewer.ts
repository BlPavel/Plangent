import { planReviews } from './index';
import { reviewTask, assertUnfrozen } from './context';
import { CodeError } from '../code/files';
import { getAgent } from '../agents';
import { createSession, getSession, updateSession } from '../agent-sessions/sessions';
import { sendPrompt } from '../agent-sessions/acp-host';
import type { AgentSession } from '../agent-sessions/types';
import type { PlanRemark, PlanMessage } from './types';
import { analysisToolContext } from '../orchestration/analysis-context';
import { resolvePlanReviewInstruction } from '../library/plan-review-instruction';
import { text } from './remarks';

export const PROTOCOL = [
  'Review the saved plan against the analysis. You are read-only: never edit files or run mutating commands.',
  'Call get_plan_review_brief first in every round. Follow the review instruction and the developer wish.',
  'Create actionable cards with add_plan_remark: steps are existing pN ids, [] means the whole plan. kind is contradiction, order, coverage, extra, unclear or risk. Include evidence and an optional suggestion.',
  'Then call set_plan_review_overview with a concise overview and coverage rows: requirement, steps, status (covered/missing/partial), remark_id. Every missing/partial row must link to a card created in this round.',
  'Use history, rejection reasons and planner answers. Do not repeat rejected remarks without new evidence. The developer decides which cards to accept, reject or discuss with you; never change the plan yourself.',
  'When a discussion changes what a card should say (the developer is right in part or in full, or you both agree on a different version), answer AND rewrite the card with revise_plan_remark: full new text and suggestion. The planner receives only the card, never the discussion, so the card must be complete and stand on its own. If you keep the remark as it is, only answer.',
  'When the developer discusses a card with you, you get a message with its id. Call get_plan_review_brief to read the thread, then answer only in that card with answer_plan_remark. Be honest: keep the remark with evidence, refine it, or say it was wrong.',
];
export function reviewerScope(session: AgentSession) {
  if (session.role !== 'plan-reviewer' || !session.task_id || typeof session.metadata.plan_review_id !== 'string') throw new CodeError('Not a plan reviewer', 403);
  const detail = planReviews().detail(session.project_id, session.task_id, session.metadata.plan_review_id);
  if (detail.review.session_id !== session.id || session.policy !== 'read-only') throw new CodeError('Review session mismatch', 403);
  assertUnfrozen(session.task_id);
  return detail;
}
export function brief(session: AgentSession) {
  const detail = reviewerScope(session);
  const { task, project } = reviewTask(session.project_id, session.task_id!);
  return { protocol: PROTOCOL, task, plan: { version: detail.review.plan_version, content: detail.review.plan_content },
    analysis: analysisToolContext(task.id, project.repo_path, task.key),
    instruction: resolvePlanReviewInstruction(project.id),
    wish: session.metadata.wish ?? '', ...detail,
    history: planReviews().list(project.id, task.id).filter(r => r.id !== detail.review.id)
      .map(r => planReviews().detail(project.id, task.id, r.id)) };
}
export function reviewerOutput(session: AgentSession, name: string, input: Record<string, unknown>) {
  const { review, remarks } = reviewerScope(session);
  const service = planReviews();
  if (name === 'revise_plan_remark') {
    const card = remarks.find(r => r.id === input.id);
    if (!card || card.status !== 'discussing') throw new CodeError('Only a card being discussed can be rewritten', 409);
    return service.revise(session.project_id, session.task_id!, review.id, card.id, input);
  }
  if (name === 'answer_plan_remark') {
    const card = remarks.find(r => r.id === input.id);
    if (!card || card.status !== 'discussing') throw new CodeError('Card is not being discussed with the reviewer', 409);
    return service.addMessage(session.project_id, session.task_id!, review.id, card.id, 'reviewer', input.text);
  }
  if (name === 'add_plan_remark') return service.addRemark(session.project_id, session.task_id!, review.id, input);
  service.setOverview(session.project_id, session.task_id!, review.id, input);
  return service.setStatus(session.project_id, session.task_id!, review.id, 'completed');
}
/** Cards the developer discusses with the reviewer that hold comments the reviewer has not received yet. */
export const waitingForReviewer = (remarks: (PlanRemark & { messages: PlanMessage[] })[]) => remarks.filter(r => r.status === 'discussing' && r.messages.some(m => m.author === 'developer' && !m.sent));
/** Sends the pending discussion comments of all cards to the reviewer's chat in one message. */
export async function askReviewer(projectId: string, taskId: string, reviewId: string) {
  reviewTask(projectId, taskId);
  assertUnfrozen(taskId);
  const service = planReviews();
  const detail = service.detail(projectId, taskId, reviewId);
  const cards = waitingForReviewer(detail.remarks);
  if (!cards.length) throw new CodeError('Nothing to send to the reviewer', 409);
  if (!detail.review.session_id) throw new CodeError('The reviewer chat is gone: run the review again', 409);
  const ids = cards.map(r => r.id);
  await sendPrompt(getSession(detail.review.session_id).id, [{ type: 'text', text: `Разработчик ответил в карточках: ${ids.join(', ')}. Вызови get_plan_review_brief, прочитай ветки этих карточек и в каждой ответь через answer_plan_remark; если по итогам обсуждения замечание должно звучать иначе, перепиши его через revise_plan_remark (планировщик увидит только карточку, без переписки). План не меняй.` }]);
  return service.delivered(projectId, taskId, reviewId, ids);
}
export async function launch(projectId: string, taskId: string, input: Record<string, unknown>) {
  const { task, project } = reviewTask(projectId, taskId);
  assertUnfrozen(taskId);
  const previous = [...planReviews().list(projectId, taskId)].find(r => r.session_id);
  let saved: AgentSession | undefined;
  if (previous?.session_id) {
    try { saved = (await import('../agent-sessions/sessions')).getSession(previous.session_id); } catch { /* deleted */ }
  }
  const agent = getAgent(text(input.agent_id ?? saved?.agent_id ?? project.default_agent_id));
  if (!agent) throw new CodeError('Choose an agent for plan review', 409);
  const wish = text(input.wish, false);
  if (saved?.agent_id !== agent.id) saved = undefined;
  const session = createSession({ project_id: projectId, task_id: taskId, agent_id: agent.id,
    role: 'plan-reviewer', policy: 'read-only', model: text(input.model ?? saved?.model ?? agent.model, false),
    title: task.key + ' · Plan review', metadata: { wish,
      reasoningEffort: text(input.reasoning_effort ?? saved?.metadata.reasoningEffort ?? agent.reasoning_effort, false),
      briefing: PROTOCOL.join('\n') } });
  const service = planReviews();
  const detail = service.create(projectId, taskId, { session_id: session.id });
  updateSession(session.id, { metadata: { ...session.metadata, plan_review_id: detail.review.id } });
  try {
    await sendPrompt(session.id, [{ type: 'text', text: 'Call get_plan_review_brief. Review the plan, create cards with add_plan_remark, then save the overview and coverage with set_plan_review_overview.' }]);
  } catch (error) {
    service.setStatus(projectId, taskId, detail.review.id, 'failed');
    throw error;
  }
  return { ...service.detail(projectId, taskId, detail.review.id), session_id: session.id };
}
