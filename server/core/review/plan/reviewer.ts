import { pendingThreads, sendReviewBatch } from '../kernel';
import { markAgentWorkFinished } from '../../agents';
import { planReviews } from './index';
import { reviewTask, assertUnfrozen } from './context';
import { DomainError } from '../../../models/domain-error';
import { selectAgent } from '../../agents';
import { createAgentSession, getSession, updateSession } from '../../agents';
import type { AgentSession } from '../../agents';
import type { PlanRemark, PlanMessage } from '../../../models/plan-review';
import { analysisToolContext } from '../../preparation';
import { resolvePlanReviewInstruction } from '../../library';
import { resolvePlanReviewSkill } from '../../library';
import { text } from './remarks';
import { getLatestMaterial, parseMaterialIdentifiers, type MaterialType } from '../../preparation';
import { getReadyMaterials } from '../../preparation';
import { resolveMaterialReviewInstruction, resolveMaterialReviewSkill } from '../../library';
import { isReviewTarget } from './index';
import type { ReviewTarget } from '../../../models/plan-review';

const TARGET_NAMES = { plan: 'plan', architecture: 'architecture document', qa: 'QA document' } as const;
/** What the reviewer is told for a material: the same flow as for a plan, with the places named by identifiers and quotes. */
function materialProtocol(target: Exclude<ReviewTarget, 'plan'>): string[] {
  const name = TARGET_NAMES[target];
  const grounds = target === 'qa' ? 'the analysis and the ready architecture' : 'the analysis, the code and the rules of the project';
  return [
    `Review the saved ${name} of the task against ${grounds}. You are read-only: never edit files or run mutating commands.`,
    `Call get_plan_review_brief first in every round. It gives the document, its grounds, the review instruction (general checks), the chosen skill (requirements of this project; null when there is none) and the developer wish. ${target === 'qa' ? 'The plan is not a ground of this review.' : 'QA and the plan are not grounds of this review: they depend on the architecture.'}`,
    'Create actionable cards with add_plan_remark: steps are identifiers (D… in the architecture, Q… in QA) that exist in the document; [] means the card concerns no single decision or criterion, then give quote - an exact quote from the document that marks the place. kind is contradiction (conflicts with a source or another part), coverage (a requirement without a decision or criterion), extra (no ground in the sources), unclear (ambiguity or imprecision), risk or suggestion.',
    'Every card names the place, the source it conflicts with (an exact rule and the dependency that violates it for a project rule), the consequence and, when it is clear, the action in suggestion. A suggestion is an improvement, not a violation: never present it as a breach of a requirement or rule. A conflict of the document with a source is not an ambiguity until you have shown that the source is clear.',
    'Then call set_plan_review_overview with a concise overview and coverage: []. A document review has no coverage table.',
    'Use history and rejection reasons. Do not repeat rejected remarks without new evidence. The developer decides which cards to accept, reject or discuss with you; never change the document yourself.',
    'When a discussion changes what a card should say (the developer is right in part or in full, or you both agree on a different version), answer AND rewrite the card with revise_plan_remark: full new text and suggestion. The author receives only the card, never the discussion, so the card must be complete and stand on its own. If you keep the remark as it is, only answer.',
    'When the developer discusses a card with you, you get a message with its id. Call get_plan_review_brief to read the thread, then answer only in that card with answer_plan_remark. Be honest: keep the remark with evidence, refine it, or say it was wrong.',
  ];
}
export const protocolOf = (target: ReviewTarget): string[] => target === 'plan' ? PROTOCOL : materialProtocol(target);

export const PROTOCOL = [
  'Review the saved plan against the analysis. You are read-only: never edit files or run mutating commands.',
  'Call get_plan_review_brief first in every round. Follow the review instruction (general checks), the chosen skill (requirements of this project; null when there is none) and the developer wish.',
  'Create actionable cards with add_plan_remark: steps are existing pN ids, [] means the whole plan. kind is contradiction, order, coverage, extra, unclear or risk. Include evidence and an optional suggestion.',
  'Then call set_plan_review_overview with a concise overview and coverage rows: requirement, steps, status (covered/missing/partial), remark_id. Every missing/partial row must link to a card created in this round.',
  'When get_plan_review_brief returns a ready QA (qa and criteria), the coverage table also holds one row per criterion: source "qa", criterion "Q…", requirement is the criterion in a few words, steps are the steps that close it. A criterion is covered only when the steps together deliver it, partial when they deliver a part, missing when no step does; missing and partial rows link to a card of kind coverage. The save is rejected while a criterion has no row. When the brief has qa: null, QA is not a ground of this review.',
  'When the brief returns a ready architecture, check that no step contradicts its decisions (D…) and name the decision in a card of kind contradiction. A step that merely does not mention a decision is not a contradiction. Without ready materials review the plan against the analysis only.',
  'Use history, rejection reasons and planner answers. Do not repeat rejected remarks without new evidence. The developer decides which cards to accept, reject or discuss with you; never change the plan yourself.',
  'When a discussion changes what a card should say (the developer is right in part or in full, or you both agree on a different version), answer AND rewrite the card with revise_plan_remark: full new text and suggestion. The planner receives only the card, never the discussion, so the card must be complete and stand on its own. If you keep the remark as it is, only answer.',
  'When the developer discusses a card with you, you get a message with its id. Call get_plan_review_brief to read the thread, then answer only in that card with answer_plan_remark. Be honest: keep the remark with evidence, refine it, or say it was wrong.',
];
export function reviewerScope(session: AgentSession) {
  if (session.role !== 'plan-reviewer' || !session.task_id || typeof session.metadata.plan_review_id !== 'string') throw new DomainError('Not a plan reviewer', 403);
  const detail = planReviews().detail(session.project_id, session.task_id, session.metadata.plan_review_id);
  if (detail.review.session_id !== session.id || session.policy !== 'read-only') throw new DomainError('Review session mismatch', 403);
  assertUnfrozen(session.task_id);
  return detail;
}
export function brief(session: AgentSession) {
  const detail = reviewerScope(session);
  const { task, project } = reviewTask(session.project_id, session.task_id!);
  const target = detail.review.target;
  const history = planReviews().list(project.id, task.id, target).filter(r => r.id !== detail.review.id)
    .map(r => planReviews().detail(project.id, task.id, r.id));
  if (target === 'plan') {
    // Only materials the developer marked ready are grounds; a draft or skipped one is absent, as for the planner.
    const grounds = getReadyMaterials(task.id);
    const described = (m: { version: number; content: string } | null) => m && { version: m.version, content: m.content, identifiers: parseMaterialIdentifiers(m.content) };
    return { protocol: PROTOCOL, task, plan: { version: detail.review.plan_version, content: detail.review.plan_content },
      analysis: analysisToolContext(task.id, project.repo_path, task.key),
      architecture: described(grounds.architecture), qa: described(grounds.qa), criteria: planReviews().readyCriteria(task.id),
      instruction: resolvePlanReviewInstruction(project.id), skill: resolvePlanReviewSkill(project.id, detail.review.skill_id),
      wish: session.metadata.wish ?? '', ...detail, history };
  }
  // A material is reviewed against its grounds only: the analysis, and for QA the architecture the developer marked ready.
  const ready = target === 'qa' ? getReadyMaterials(task.id).architecture : null;
  return { protocol: protocolOf(target), target, task,
    document: { type: target, version: detail.review.plan_version, content: detail.review.plan_content, identifiers: parseMaterialIdentifiers(detail.review.plan_content) },
    analysis: analysisToolContext(task.id, project.repo_path, task.key),
    ...(target === 'qa' ? ready
      ? { architecture: { version: ready.version, content: ready.content, identifiers: parseMaterialIdentifiers(ready.content) } }
      : { architecture: null, architectureNote: 'The architecture is not marked ready by the developer, so it is not a ground for QA.' } : {}),
    instruction: resolveMaterialReviewInstruction(target, project.id), skill: resolveMaterialReviewSkill(target, project.id, detail.review.skill_id),
    wish: session.metadata.wish ?? '', ...detail, history };
}
export function reviewerOutput(session: AgentSession, name: string, input: Record<string, unknown>) {
  const { review, remarks } = reviewerScope(session);
  const service = planReviews();
  if (name === 'revise') {
    const card = remarks.find(r => r.id === input.id);
    if (!card || card.status !== 'discussing') throw new DomainError('Only a card being discussed can be rewritten', 409);
    return service.revise(session.project_id, session.task_id!, review.id, card.id, input);
  }
  if (name === 'answer') {
    const card = remarks.find(r => r.id === input.id);
    if (!card || card.status !== 'discussing') throw new DomainError('Card is not being discussed with the reviewer', 409);
    const result = service.addMessage(session.project_id, session.task_id!, review.id, card.id, 'reviewer', input.text);
    const remaining = service.detail(session.project_id, session.task_id!, review.id).remarks.some(r =>
      r.status === 'discussing' && r.messages.at(-1)?.author === 'developer' && r.messages.at(-1)?.sent);
    if (!remaining) markAgentWorkFinished(session.id);
    return result;
  }
  if (name === 'add') return service.addRemark(session.project_id, session.task_id!, review.id, input);
  service.setOverview(session.project_id, session.task_id!, review.id, input);
  markAgentWorkFinished(session.id);
  return service.setStatus(session.project_id, session.task_id!, review.id, 'completed');
}
/** Cards the developer discusses with the reviewer that hold comments the reviewer has not received yet. */
export const waitingForReviewer = (remarks: (PlanRemark & { messages: PlanMessage[] })[]) => pendingThreads(remarks.filter(r => r.status === 'discussing'), r => r.messages);
/** Sends the pending discussion comments of all cards to the reviewer's chat in one message. */
export async function askReviewer(projectId: string, taskId: string, reviewId: string) {
  reviewTask(projectId, taskId);
  assertUnfrozen(taskId);
  const service = planReviews();
  const detail = service.detail(projectId, taskId, reviewId);
  const cards = waitingForReviewer(detail.remarks);
  if (!cards.length) throw new DomainError('Nothing to send to the reviewer', 409);
  if (!detail.review.session_id) throw new DomainError('The reviewer chat is gone: run the review again', 409);
  const ids = cards.map(r => r.id);
  const plan = detail.review.target === 'plan';
  await sendReviewBatch(getSession(detail.review.session_id).id, `The developer replied to cards: ${ids.join(', ')}. Call get_plan_review_brief, read each thread, and reply to each with answer_plan_remark. If the discussion changes a remark, rewrite it with revise_plan_remark; the ${plan ? 'planner' : 'document author'} sees only the card, not the conversation. Do not change the ${plan ? 'plan' : 'document'}. Respond in the developer's language, Russian by default.`);
  return service.delivered(projectId, taskId, reviewId, ids);
}
export async function launch(projectId: string, taskId: string, input: Record<string, unknown>) {
  const { task, project } = reviewTask(projectId, taskId);
  assertUnfrozen(taskId);
  const target = input.target ?? 'plan';
  if (!isReviewTarget(target)) throw new DomainError('Invalid review target');
  if (target !== 'plan' && !getLatestMaterial(taskId, target)) throw new DomainError('Nothing to review: the document does not exist yet', 409);
  const previous = [...planReviews().list(projectId, taskId, target)].find(r => r.session_id);
  let saved: AgentSession | undefined;
  if (previous?.session_id) {
    try { saved = (await import('../../agents')).getSession(previous.session_id); } catch { /* deleted */ }
  }
  const agent = selectAgent(projectId, { explicit: input.agent_id === undefined ? undefined : text(input.agent_id), saved: saved?.agent_id });
  if (!agent) throw new DomainError('Choose an agent for the review', 409);
  const wish = text(input.wish, false);
  if (saved?.agent_id !== agent.id) saved = undefined;
  const session = createAgentSession({ project_id: projectId, task_id: taskId, agent_id: agent.id,
    role: 'plan-reviewer', policy: 'read-only', model: text(input.model ?? saved?.model ?? agent.model, false),
    title: task.key + ' · ' + { plan: 'Plan review', architecture: 'Architecture review', qa: 'QA review' }[target], metadata: { wish, review_target: target,
      reasoningEffort: text(input.reasoning_effort ?? saved?.metadata.reasoningEffort ?? agent.reasoning_effort, false),
      briefing: protocolOf(target).join('\n') } });
  const service = planReviews();
  const skillId = typeof input.skill_id === 'string' ? input.skill_id : previous?.skill_id;
  const skill = target === 'plan' ? resolvePlanReviewSkill(projectId, skillId) : resolveMaterialReviewSkill(target, projectId, skillId);
  const detail = service.create(projectId, taskId, { session_id: session.id, skill_id: skill?.id ?? null, target });
  updateSession(session.id, { metadata: { ...session.metadata, plan_review_id: detail.review.id } });
  try {
    await sendReviewBatch(session.id, target === 'plan' ? 'Call get_plan_review_brief. Review the plan, create cards with add_plan_remark, then save the overview and coverage with set_plan_review_overview.'
      : `Call get_plan_review_brief. Review the ${TARGET_NAMES[target]}, create cards with add_plan_remark, then save the overview with set_plan_review_overview.`);
  } catch (error) {
    service.setStatus(projectId, taskId, detail.review.id, 'failed');
    throw error;
  }
  return { ...service.detail(projectId, taskId, detail.review.id), session_id: session.id };
}
