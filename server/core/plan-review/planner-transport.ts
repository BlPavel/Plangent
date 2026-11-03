import { rootForTask } from '../workspaces/roots';
import { getPlanFilePath } from '../orchestration/task-files';
import { CodeError } from '../code/files';
import { getAgent } from '../agents';
import { getLatestPlan } from '../orchestration/plans';
import { createPlannerSession } from '../orchestration/planner-session';
import { buildPrompt } from '../orchestration/prompts';
import { materializePlanFile, watchPlanFile } from '../orchestration/plan-file';
import { listSessions, getSession, updateSession, createSession } from '../agent-sessions/sessions';
import { sendPrompt, sessionAvailability } from '../agent-sessions/acp-host';
import type { AgentSession } from '../agent-sessions/types';
import { planReviews } from './index';
import { reviewTask, assertUnfrozen } from './context';
import { text } from './remarks';
import { getLatestMaterial } from '../materials';
import { MATERIAL_KINDS } from '../materials/kinds';
import type { ReviewTarget } from './types';

const active = new Set<string>();
/** Who receives the accepted cards: planners for a plan, authors of the same document type for a material. */
export function candidates(projectId: string, taskId: string, target: ReviewTarget = 'plan') {
  reviewTask(projectId, taskId);
  const written = target === 'plan' ? getLatestPlan(taskId) : getLatestMaterial(taskId, target);
  const chats = listSessions(projectId).filter(s => s.task_id === taskId && (target === 'plan' ? s.role === 'planner' : s.role === 'material-author' && s.metadata.material_type === target))
    .map(s => ({ id: s.id, title: s.title, ...sessionAvailability(s.id) }));
  const author = written?.author === 'agent' ? chats.find(s => s.id === written.session_id) : undefined;
  return { sessions: chats, default_session_id: author?.available ? author.id : null };
}
export async function deliver(projectId: string, taskId: string, reviewId: string, input: Record<string, unknown>) {
  const { task, project } = reviewTask(projectId, taskId);
  assertUnfrozen(taskId);
  if (active.has(taskId)) throw new CodeError('Planner delivery in progress', 409);
  const service = planReviews();
  const detail = service.detail(projectId, taskId, reviewId);
  // The planner gets the accepted cards, and only once every card has a decision.
  if (detail.remarks.some(r => ['open', 'discussing', 'answered'].includes(r.status))) throw new CodeError('Every card needs a decision before sending', 409);
  const cards = detail.remarks.filter(r => r.status === 'accepted');
  if (!cards.length) throw new CodeError('No accepted cards to send', 409);
  const target = detail.review.target;
  const selection = candidates(projectId, taskId, target);
  if (input.session_id !== undefined && input.session_id !== null && (typeof input.session_id !== 'string' || !input.session_id.trim())) throw new CodeError('Invalid planner session');
  const selected = input.session_id === null ? null : input.session_id ?? selection.default_session_id;
  let session: AgentSession;
  if (selected) {
    if (typeof selected !== 'string') throw new CodeError('Invalid planner session');
    const candidate = selection.sessions.find(s => s.id === selected);
    if (!candidate) throw new CodeError('Planner not found', 404);
    if (!candidate.available) throw new CodeError(candidate.busy ? 'Planner is responding; choose a new planner' : 'Planner cannot resume; choose a new planner', 409);
    session = getSession(selected);
  } else {
    const agent = getAgent(text(input.agent_id ?? project.default_agent_id));
    if (!agent) throw new CodeError('Choose a planning agent', 409);
    const common = { project_id: projectId, task_id: taskId, agent_id: agent.id, model: text(input.model ?? agent.model, false) };
    const effort = text(input.reasoning_effort ?? agent.reasoning_effort, false);
    const context = { projectName: project.name, taskKey: task.key, taskId, repoPath: rootForTask(taskId), analysisRepoPath: project.repo_path, planFilePath: getPlanFilePath(project.repo_path, task.key), runHistory: [] };
    session = target === 'plan'
      ? createPlannerSession({ ...common, title: task.key + ' · Planning', metadata: { reasoningEffort: effort, briefing: buildPrompt({ ...context, purpose: 'plan' }) } })
      : createSession({ ...common, role: 'material-author', policy: 'read-only', title: task.key + ' · ' + MATERIAL_KINDS[target].title,
        metadata: { reasoningEffort: effort, material_type: target, briefing: buildPrompt({ ...context, purpose: target }) } });
  }
  const previousMetadata = session.metadata;
  active.add(taskId);
  try {
    if (target === 'plan') {
      const latest = getLatestPlan(taskId)!;
      materializePlanFile(task, latest, project.repo_path);
      watchPlanFile(task, latest.id, project.repo_path);
    }
    updateSession(session.id, { metadata: { ...previousMetadata, plan_review_batch: { review_id: reviewId, ids: cards.map(r => r.id) } } });
    // Only MCP carries cards, thread history and decisions; chat text cannot replace structured replies.
    await sendPrompt(session.id, [{ type: 'text', text: target === 'plan'
      ? `Ревью плана: принятых замечаний — ${cards.length}. Возьми их через get_plan_review_items и исправь план по правилам оттуда.`
      : `Ревью документа «${MATERIAL_KINDS[target].title}»: принятых замечаний — ${cards.length}. Возьми их через get_plan_review_items и исправь документ по правилам оттуда.` }]);
    service.sent(projectId, taskId, reviewId, cards.map(r => r.id), session.id);
    return { ...service.detail(projectId, taskId, reviewId), session_id: session.id };
  } catch (error) {
    updateSession(session.id, { metadata: { ...getSession(session.id).metadata, plan_review_batch: previousMetadata.plan_review_batch } });
    throw error;
  } finally { active.delete(taskId); }
}
/** The target a recipient session serves: a planner takes plan cards, a material author the cards of its own document type. */
function recipientTarget(session: AgentSession): ReviewTarget {
  if (session.role === 'planner') return 'plan';
  const type = session.metadata.material_type;
  if (session.role === 'material-author' && (type === 'architecture' || type === 'qa')) return type;
  throw new CodeError('Not a recipient of review cards', 403);
}
function batch(session: AgentSession) {
  if (!session.task_id) throw new CodeError('Not a recipient of review cards', 403);
  const target = recipientTarget(session);
  const data = session.metadata.plan_review_batch as { review_id?: unknown; ids?: unknown } | undefined;
  if (!data || typeof data.review_id !== 'string' || !Array.isArray(data.ids)) throw new CodeError('No plan review batch', 409);
  const detail = planReviews().detail(session.project_id, session.task_id, data.review_id);
  if (detail.review.target !== target) throw new CodeError('The review batch is for another document', 403);
  return { ...detail, assigned: detail.remarks.filter(r => (data.ids as unknown[]).includes(r.id) && r.planner_session_id === session.id) };
}
export function items(session: AgentSession) {
  const detail = batch(session);
  // The planner works from the card alone: the discussion with the reviewer stays out. The developer's clarification, if any, comes with it.
  const cards = detail.assigned.map(r => ({ id: r.id, steps: r.steps.filter(s => !s.deleted).map(s => s.id), ...(r.quote ? { quote: r.quote } : {}), kind: r.kind, text: r.text, suggestion: r.suggestion,
    ...(r.sent_status === 'accepted' && r.decision ? { developer_clarification: r.decision } : {}) }));
  if (detail.review.target !== 'plan') return { protocol: 'The document may have changed since the review: call get_material first. Each card is the single source of what to fix: its text and suggestion are final; steps are the identifiers (D/Q) it points at and quote marks the place when there is no identifier. A developer_clarification, when present, is the developer own instruction and wins over the text and suggestion where they differ. Fix the accepted cards, saving the whole document with submit_material; keep existing identifiers. Reply with reply_plan_remark (questions/options/disagree) only when you cannot or should not apply a card; answers in the general chat do not replace replies in cards. When the document is saved, write a short report in the chat for the developer: for every accepted card what you changed and where, and which cards you did not apply and why. Then stay available for questions. Never close cards yourself.',
    review: { id: detail.review.id, round: detail.review.round, target: detail.review.target }, assigned: cards };
  return { protocol: 'The plan may have changed since the review: call get_plan first. Each card is the single source of what to fix: its text and suggestion are final. A developer_clarification, when present, is the developer own instruction and wins over the text and suggestion where they differ. Fix the accepted cards, using submit_plan. Reply with reply_plan_remark (questions/options/disagree) only when you cannot or should not apply a card; answers in the general chat do not replace replies in cards. When the plan is saved, write a short report in the chat for the developer: for every accepted card what you changed and in which steps (current pN ids), and which cards you did not apply and why. Then stay available for questions. Explain changes using current pN ids; keep every answer in its card. Never close cards yourself.',
    review: { id: detail.review.id, round: detail.review.round }, assigned: cards };
}
export function reply(session: AgentSession, input: Record<string, unknown>) {
  const detail = batch(session);
  if (!detail.assigned.some(r => r.id === input.id && ['sent', 'applied'].includes(r.status))) throw new CodeError('Card is not assigned to this session', 403);
  if (!['answer', 'options', 'questions', 'change', 'disagree'].includes(String(input.kind))) throw new CodeError('Invalid reply kind');
  return planReviews().addMessage(session.project_id, session.task_id!, detail.review.id, String(input.id), 'planner',
    String(input.kind) + ': ' + text(input.text));
}
