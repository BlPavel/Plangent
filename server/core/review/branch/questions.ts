import { transaction } from '../../../infrastructure/db/repositories/review/transaction';
import * as queries from '../../../infrastructure/db/repositories/review/branch/questions';
import { parseReply, awaitingReply, sendReviewBatch } from '../kernel';
import { randomUUID } from 'node:crypto';
import { broadcast } from '../../shared';
import { DomainError } from '../../../models/domain-error';
import { cancelSession } from '../../agents';
import type { AgentSession } from '../../agents';
import { checkLine, openIdleThread } from './index';

/**
 * The developer's questions about a branch, as threads with the agent: replies wait (sent=0) and leave in
 * one batch; the agent answers each thread through MCP (reply_branch_question), never in the chat.
 */
export interface BranchQuestion { id: string; review_id: string; path: string; side: 'old' | 'new'; line: number; closed: boolean; created_at: string }
export interface BranchQuestionMessage { id: string; question_id: string; author: 'developer' | 'agent'; kind: string; text: string; sent: boolean; created_at: string }
type QuestionRow = Omit<BranchQuestion, 'closed'> & { closed: number };
type MessageRow = Omit<BranchQuestionMessage, 'sent'> & { sent: number };
const REPLY_KINDS = ['answer', 'options', 'questions'];
const parseQuestion = (row: QuestionRow): BranchQuestion => ({ ...row, closed: row.closed === 1 });
const parseMessage = (row: MessageRow): BranchQuestionMessage => ({ ...row, sent: row.sent === 1 });

function reviewProject(reviewId: string): string {
  const row = queries.rowSelectBranchReviews(reviewId) as { project_id: string } | undefined;
  if (!row) throw new DomainError('Ревью не найдено', 404);
  return row.project_id;
}
function ownReview(projectId: string, reviewId: string) {
  if (reviewProject(reviewId) !== projectId) throw new DomainError('Ревью не найдено', 404);
}
function question(reviewId: string, id: string): BranchQuestion {
  const row = queries.rowSelectBranchQuestions(id, reviewId) as QuestionRow | undefined;
  if (!row) throw new DomainError('Вопрос не найден', 404);
  return parseQuestion(row);
}
const notify = (reviewId: string) => broadcast({ type: 'branch_review_updated', projectId: reviewProject(reviewId), reviewId });

export function list(projectId: string, reviewId: string) {
  ownReview(projectId, reviewId);
  const questions = (queries.questionsSelectBranchQuestions(reviewId) as QuestionRow[]).map(parseQuestion);
  const messages = (queries.messagesSelectBranchQuestionMessages(reviewId) as MessageRow[]).map(parseMessage);
  return { questions, messages };
}
const thread = (questionId: string) => (queries.threadSelectBranchQuestionMessages(questionId) as MessageRow[]).map(parseMessage);
/** The agent owes an answer: the last word is the developer's and it has been sent. */
const awaiting = (questionId: string) => awaitingReply(thread(questionId));
const cleanText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim().slice(0, 8000) : '';
  if (!text) throw new DomainError('Напишите вопрос');
  return text;
};

export async function add(projectId: string, reviewId: string, input: { path?: unknown; side?: unknown; line?: unknown; text?: unknown }) {
  ownReview(projectId, reviewId);
  const text = cleanText(input.text);
  const general = input.path === undefined || input.path === '';
  if (!general) await checkLine(projectId, reviewId, input.path, input.side, input.line);
  const id = randomUUID();
  transaction(() => {
    queries.addInsertBranchQuestions(id, reviewId, general ? '' : String(input.path), general ? 'new' : String(input.side), general ? 0 : Number(input.line));
    queries.addInsertBranchQuestionMessages(randomUUID(), id, text);
  });
  notify(reviewId);
  return list(projectId, reviewId);
}
/** A reply in a thread; writing to a closed one reopens it. */
export function reply(projectId: string, reviewId: string, questionId: string, text: unknown) {
  ownReview(projectId, reviewId);
  const q = question(reviewId, questionId), body = cleanText(text);
  transaction(() => {
    queries.replyInsertBranchQuestionMessages(randomUUID(), q.id, body);
    if (q.closed) queries.replyUpdateBranchQuestions(q.id);
  });
  notify(reviewId);
  return list(projectId, reviewId);
}
/** Edits a message that has not been sent yet. */
export function edit(projectId: string, reviewId: string, questionId: string, messageId: string, text: unknown) {
  ownReview(projectId, reviewId); question(reviewId, questionId);
  const changed = queries.changedUpdateBranchQuestionMessages(cleanText(text), messageId, questionId).changes;
  if (!changed) throw new DomainError('Сообщение уже отправлено', 409);
  notify(reviewId);
  return list(projectId, reviewId);
}
/** Removes a queued message; a question left without messages disappears with it. */
export function removeMessage(projectId: string, reviewId: string, questionId: string, messageId: string) {
  ownReview(projectId, reviewId); question(reviewId, questionId);
  const changed = queries.changedDeleteBranchQuestionMessages(messageId, questionId).changes;
  if (!changed) throw new DomainError('Сообщение уже отправлено', 409);
  if (!thread(questionId).length) queries.removeMessageDeleteBranchQuestions(questionId);
  notify(reviewId);
  return list(projectId, reviewId);
}
export function close(projectId: string, reviewId: string, questionId: string, closed: boolean) {
  ownReview(projectId, reviewId); question(reviewId, questionId);
  queries.closeUpdateBranchQuestions(closed ? 1 : 0, questionId);
  notify(reviewId);
  return list(projectId, reviewId);
}

const plural = (n: number, one: string, few: string, many: string) =>
  n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
/**
 * Sends the queued messages (all, or of the given questions) to the review's agent in one prompt.
 * `agent` picks who answers when the review has no session for the current head yet.
 */
export async function send(projectId: string, reviewId: string, input: { question_ids?: unknown }) {
  ownReview(projectId, reviewId);
  const wanted = Array.isArray(input.question_ids) ? new Set(input.question_ids.filter((id): id is string => typeof id === 'string')) : null;
  const queued = (queries.queuedSelectBranchQuestionMessages(reviewId) as MessageRow[])
    .filter(m => !wanted || wanted.has(m.question_id));
  if (!queued.length) throw new DomainError('Нечего отправлять', 409);
  const session = await openIdleThread(projectId, reviewId, 'Агент отвечает: дождитесь конца ответа');
  const fresh = new Set(queued.filter(m => !thread(m.question_id).some(x => x.sent)).map(m => m.question_id)).size;
  const total = new Set(queued.map(m => m.question_id)).size;
  const mark = queries.markUpdateBranchQuestionMessages;
  transaction(() => { for (const m of queued) mark(1, m.id); });
  const parts = [fresh && plural(fresh, 'новый вопрос', 'новых вопроса', 'новых вопросов'), total - fresh && plural(total - fresh, 'ответ в обсуждении', 'ответа в обсуждениях', 'ответов в обсуждениях')].filter(Boolean);
  await sendReviewBatch(session.session_id, `Branch review: ${total} items (${fresh} new questions). Call get_branch_questions and reply in each thread through reply_branch_question.`, () => {
    transaction(() => { for (const m of queued) mark(0, m.id); });
  });
  notify(reviewId);
  return { ...list(projectId, reviewId), thread: session };
}

const PROTOCOL = 'You answer the developer’s questions about the branch in a read-only worktree; do not change code or git. ' +
  'Each question is a separate thread. Call reply_branch_question exactly once per thread per turn; do not answer in chat. ' +
  'Use kind answer for an ordinary answer, options for a list of choices with your recommendation, and questions for clarifications. Be concise and cite files and lines. Respond in the developer’s language, Russian by default.';
function sessionReview(session: AgentSession): string {
  const id = session.metadata.branch_review;
  if (typeof id !== 'string') throw new DomainError('Это не сессия ревью ветки');
  return id;
}
/** What get_branch_questions returns: threads waiting for the agent in full, other threads as context. */
export function agentView(session: AgentSession) {
  const reviewId = sessionReview(session);
  const all = list(reviewProject(reviewId), reviewId);
  const view = (q: BranchQuestion) => ({ id: q.id, where: q.path ? `${q.path}:${q.line} (${q.side === 'old' ? 'версия до изменений' : 'новая версия'})` : 'вся ветка',
    thread: all.messages.filter(m => m.question_id === q.id && m.sent).map(m => ({ author: m.author, kind: m.kind, text: m.text })) });
  return {
    protocol: PROTOCOL,
    assigned: all.questions.filter(q => awaiting(q.id)).map(view),
    context: all.questions.filter(q => !awaiting(q.id) && thread(q.id).some(m => m.sent)).map(view),
  };
}
export function agentReply(session: AgentSession, questionId: string, input: { kind?: unknown; text?: unknown }) {
  const reviewId = sessionReview(session);
  const q = question(reviewId, questionId), kind = String(input.kind ?? ''), text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!REPLY_KINDS.includes(kind) || !text) throw new DomainError('Invalid reply: kind is answer|options|questions and text is required');
  if (!awaiting(q.id)) throw new DomainError('Question is not waiting for you', 409);
  queries.agentReplyInsertBranchQuestionMessages(randomUUID(), q.id, kind, text);
  notify(reviewId);
  return { ok: true };
}

/** Interrupts the agent; threads it has not answered return to the queue so they can be sent again. */
export async function stop(projectId: string, reviewId: string) {
  ownReview(projectId, reviewId);
  // An interrupted review is not a finished one: the end of the cancelled turn must not mark it done.
  queries.stopUpdateBranchReviews(reviewId);
  for (const t of queries.stopSelectBranchReviewThreads(reviewId) as { session_id: string }[]) await cancelSession(t.session_id).catch(() => undefined);
  const { questions } = list(projectId, reviewId);
  transaction(() => {
    for (const q of questions.filter(x => awaiting(x.id))) {
      const last = thread(q.id).at(-1)!;
      queries.stopUpdateBranchQuestionMessages(last.id);
    }
  });
  notify(reviewId);
  return list(projectId, reviewId);
}
