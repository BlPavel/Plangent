import { CodeError } from '../code/files';
import { getAgent } from '../agents';
import { getLatestPlan } from '../orchestration/plans';
import { createPlannerSession } from '../orchestration/planner-session';
import { buildPrompt } from '../orchestration/prompts';
import { materializePlanFile, watchPlanFile } from '../orchestration/plan-file';
import { listSessions, getSession, updateSession } from '../agent-sessions/sessions';
import { sendPrompt, sessionAvailability } from '../agent-sessions/acp-host';
import type { AgentSession } from '../agent-sessions/types';
import { planReviews } from './index';
import { reviewTask, assertUnfrozen } from './context';
import { text } from './remarks';

const active = new Set<string>();
export function candidates(projectId: string, taskId: string) {
  reviewTask(projectId, taskId);
  const plan = getLatestPlan(taskId);
  const chats = listSessions(projectId).filter(s => s.task_id === taskId && s.role === 'planner')
    .map(s => ({ id: s.id, title: s.title, ...sessionAvailability(s.id) }));
  const author = plan?.author === 'agent' ? chats.find(s => s.id === plan.session_id) : undefined;
  return { sessions: chats, default_session_id: author?.available ? author.id : null };
}
export async function deliver(projectId: string, taskId: string, reviewId: string, input: Record<string, unknown>) {
  const { task, project } = reviewTask(projectId, taskId);
  assertUnfrozen(taskId);
  if (active.has(taskId)) throw new CodeError('Planner delivery in progress', 409);
  const service = planReviews();
  const detail = service.detail(projectId, taskId, reviewId);
  const cards = detail.remarks.filter(r => r.status === 'accepted' || r.status === 'discussing');
  if (!cards.length) throw new CodeError('No cards ready to send', 409);
  const selection = candidates(projectId, taskId);
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
    session = createPlannerSession({ project_id: projectId, task_id: taskId, agent_id: agent.id,
      model: text(input.model ?? agent.model, false), title: task.key + ' · Planning',
      metadata: { reasoningEffort: text(input.reasoning_effort ?? agent.reasoning_effort, false),
        briefing: buildPrompt({ projectName: project.name, taskKey: task.key, taskId, repoPath: project.repo_path,
          purpose: 'plan', runHistory: [] }) } });
  }
  const previousMetadata = session.metadata;
  active.add(taskId);
  try {
    const latest = getLatestPlan(taskId)!;
    materializePlanFile(task, latest, project.repo_path);
    watchPlanFile(task, latest.id, project.repo_path);
    updateSession(session.id, { metadata: { ...previousMetadata, plan_review_batch: { review_id: reviewId, ids: cards.map(r => r.id) } } });
    // Only MCP carries cards, thread history and decisions; chat text cannot replace structured replies.
    await sendPrompt(session.id, [{ type: 'text', text: 'План мог измениться — сначала вызови get_plan. Затем get_plan_review_items. Исправляй план через submit_plan только по принятым замечаниям. На каждое обсуждаемое замечание ответь через reply_plan_remark: ответ, варианты, вопросы или несогласие с доводами. Ответы в общем чате не заменяют ответы в карточках.' }]);
    service.sent(projectId, taskId, reviewId, cards.map(r => r.id), session.id);
    return { ...service.detail(projectId, taskId, reviewId), session_id: session.id };
  } catch (error) {
    updateSession(session.id, { metadata: { ...getSession(session.id).metadata, plan_review_batch: previousMetadata.plan_review_batch } });
    throw error;
  } finally { active.delete(taskId); }
}
function batch(session: AgentSession) {
  if (session.role !== 'planner' || !session.task_id) throw new CodeError('Not a planner', 403);
  const data = session.metadata.plan_review_batch as { review_id?: unknown; ids?: unknown } | undefined;
  if (!data || typeof data.review_id !== 'string' || !Array.isArray(data.ids)) throw new CodeError('No plan review batch', 409);
  const detail = planReviews().detail(session.project_id, session.task_id, data.review_id);
  return { ...detail, assigned: detail.remarks.filter(r => (data.ids as unknown[]).includes(r.id) && r.planner_session_id === session.id) };
}
export function items(session: AgentSession) {
  const detail = batch(session);
  return { protocol: 'Call get_plan first. Fix accepted cards only, using submit_plan. Reply to every discussion with reply_plan_remark (answer/options/questions/change/disagree). Explain changes using current pN ids; keep every answer in its card. Never close cards yourself.',
    review: detail.review, assigned: detail.assigned };
}
export function reply(session: AgentSession, input: Record<string, unknown>) {
  const detail = batch(session);
  if (!detail.assigned.some(r => r.id === input.id && ['sent', 'applied'].includes(r.status))) throw new CodeError('Card is not assigned to this planner', 403);
  if (!['answer', 'options', 'questions', 'change', 'disagree'].includes(String(input.kind))) throw new CodeError('Invalid reply kind');
  return planReviews().addMessage(session.project_id, session.task_id!, detail.review.id, String(input.id), 'planner',
    String(input.kind) + ': ' + text(input.text));
}
