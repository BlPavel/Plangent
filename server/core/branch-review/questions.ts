import { randomUUID } from 'node:crypto';
import { getDb } from '../../infrastructure/db/schema';
import { broadcast } from '../shared/events';
import { CodeError } from '../code/files';
import { cancelSession, sendPrompt } from '../agent-sessions/acp-host';
import type { AgentSession } from '../agent-sessions/types';
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
const db = () => getDb();
const parseQuestion = (row: QuestionRow): BranchQuestion => ({ ...row, closed: row.closed === 1 });
const parseMessage = (row: MessageRow): BranchQuestionMessage => ({ ...row, sent: row.sent === 1 });

function reviewProject(reviewId: string): string {
  const row = db().prepare('SELECT project_id FROM branch_reviews WHERE id=?').get(reviewId) as { project_id: string } | undefined;
  if (!row) throw new CodeError('Ревью не найдено', 404);
  return row.project_id;
}
function ownReview(projectId: string, reviewId: string) {
  if (reviewProject(reviewId) !== projectId) throw new CodeError('Ревью не найдено', 404);
}
function question(reviewId: string, id: string): BranchQuestion {
  const row = db().prepare('SELECT * FROM branch_questions WHERE id=? AND review_id=?').get(id, reviewId) as QuestionRow | undefined;
  if (!row) throw new CodeError('Вопрос не найден', 404);
  return parseQuestion(row);
}
const notify = (reviewId: string) => broadcast({ type: 'branch_review_updated', projectId: reviewProject(reviewId), reviewId });

export function list(projectId: string, reviewId: string) {
  ownReview(projectId, reviewId);
  const questions = (db().prepare('SELECT * FROM branch_questions WHERE review_id=? ORDER BY created_at,rowid').all(reviewId) as QuestionRow[]).map(parseQuestion);
  const messages = (db().prepare('SELECT m.* FROM branch_question_messages m JOIN branch_questions q ON q.id=m.question_id WHERE q.review_id=? ORDER BY m.created_at,m.rowid').all(reviewId) as MessageRow[]).map(parseMessage);
  return { questions, messages };
}
const thread = (questionId: string) => (db().prepare('SELECT * FROM branch_question_messages WHERE question_id=? ORDER BY created_at,rowid').all(questionId) as MessageRow[]).map(parseMessage);
/** The agent owes an answer: the last word is the developer's and it has been sent. */
const awaiting = (questionId: string) => { const last = thread(questionId).at(-1); return !!last && last.author === 'developer' && last.sent; };
const cleanText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim().slice(0, 8000) : '';
  if (!text) throw new CodeError('Напишите вопрос');
  return text;
};

export async function add(projectId: string, reviewId: string, input: { path?: unknown; side?: unknown; line?: unknown; text?: unknown }) {
  ownReview(projectId, reviewId);
  const text = cleanText(input.text);
  const general = input.path === undefined || input.path === '';
  if (!general) await checkLine(projectId, reviewId, input.path, input.side, input.line);
  const id = randomUUID();
  db().transaction(() => {
    db().prepare('INSERT INTO branch_questions(id,review_id,path,side,line) VALUES (?,?,?,?,?)').run(id, reviewId, general ? '' : String(input.path), general ? 'new' : String(input.side), general ? 0 : Number(input.line));
    db().prepare("INSERT INTO branch_question_messages(id,question_id,author,kind,text) VALUES (?,?,'developer','text',?)").run(randomUUID(), id, text);
  })();
  notify(reviewId);
  return list(projectId, reviewId);
}
/** A reply in a thread; writing to a closed one reopens it. */
export function reply(projectId: string, reviewId: string, questionId: string, text: unknown) {
  ownReview(projectId, reviewId);
  const q = question(reviewId, questionId), body = cleanText(text);
  db().transaction(() => {
    db().prepare("INSERT INTO branch_question_messages(id,question_id,author,kind,text) VALUES (?,?,'developer','text',?)").run(randomUUID(), q.id, body);
    if (q.closed) db().prepare('UPDATE branch_questions SET closed=0 WHERE id=?').run(q.id);
  })();
  notify(reviewId);
  return list(projectId, reviewId);
}
/** Edits a message that has not been sent yet. */
export function edit(projectId: string, reviewId: string, questionId: string, messageId: string, text: unknown) {
  ownReview(projectId, reviewId); question(reviewId, questionId);
  const changed = db().prepare("UPDATE branch_question_messages SET text=? WHERE id=? AND question_id=? AND author='developer' AND sent=0").run(cleanText(text), messageId, questionId).changes;
  if (!changed) throw new CodeError('Сообщение уже отправлено', 409);
  notify(reviewId);
  return list(projectId, reviewId);
}
/** Removes a queued message; a question left without messages disappears with it. */
export function removeMessage(projectId: string, reviewId: string, questionId: string, messageId: string) {
  ownReview(projectId, reviewId); question(reviewId, questionId);
  const changed = db().prepare("DELETE FROM branch_question_messages WHERE id=? AND question_id=? AND author='developer' AND sent=0").run(messageId, questionId).changes;
  if (!changed) throw new CodeError('Сообщение уже отправлено', 409);
  if (!thread(questionId).length) db().prepare('DELETE FROM branch_questions WHERE id=?').run(questionId);
  notify(reviewId);
  return list(projectId, reviewId);
}
export function close(projectId: string, reviewId: string, questionId: string, closed: boolean) {
  ownReview(projectId, reviewId); question(reviewId, questionId);
  db().prepare('UPDATE branch_questions SET closed=? WHERE id=?').run(closed ? 1 : 0, questionId);
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
  const queued = (db().prepare("SELECT m.* FROM branch_question_messages m JOIN branch_questions q ON q.id=m.question_id WHERE q.review_id=? AND m.author='developer' AND m.sent=0 ORDER BY m.created_at,m.rowid").all(reviewId) as MessageRow[])
    .filter(m => !wanted || wanted.has(m.question_id));
  if (!queued.length) throw new CodeError('Нечего отправлять', 409);
  const session = await openIdleThread(projectId, reviewId, 'Агент отвечает: дождитесь конца ответа');
  const fresh = new Set(queued.filter(m => !thread(m.question_id).some(x => x.sent)).map(m => m.question_id)).size;
  const total = new Set(queued.map(m => m.question_id)).size;
  const mark = db().prepare('UPDATE branch_question_messages SET sent=? WHERE id=?');
  db().transaction(() => { for (const m of queued) mark.run(1, m.id); })();
  const parts = [fresh && plural(fresh, 'новый вопрос', 'новых вопроса', 'новых вопросов'), total - fresh && plural(total - fresh, 'ответ в обсуждении', 'ответа в обсуждениях', 'ответов в обсуждениях')].filter(Boolean);
  try { await sendPrompt(session.session_id, [{ type: 'text', text: `Ревью ветки: ${parts.join(' и ')}. Возьми их через get_branch_questions и ответь в каждой ветке через reply_branch_question.` }]); }
  catch (error) {
    db().transaction(() => { for (const m of queued) mark.run(0, m.id); })();
    throw error;
  }
  notify(reviewId);
  return { ...list(projectId, reviewId), thread: session };
}

const PROTOCOL = 'Ты отвечаешь на вопросы разработчика о ветке, код не меняешь и git не трогаешь (ты работаешь в копии ветки только для чтения). ' +
  'Каждый вопрос — отдельная ветка обсуждения. Ответь в каждой через reply_branch_question ровно один раз за ход, в чат ответы не пиши. ' +
  'kind: answer — обычный ответ; options — варианты списком с твоей рекомендацией; questions — уточняющие вопросы разработчику. Отвечай по делу и кратко, с указанием файлов и строк.';
function sessionReview(session: AgentSession): string {
  const id = session.metadata.branch_review;
  if (typeof id !== 'string') throw new CodeError('Это не сессия ревью ветки');
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
  if (!REPLY_KINDS.includes(kind) || !text) throw new CodeError('Invalid reply: kind is answer|options|questions and text is required');
  if (!awaiting(q.id)) throw new CodeError('Question is not waiting for you', 409);
  db().prepare("INSERT INTO branch_question_messages(id,question_id,author,kind,text,sent) VALUES (?,?,'agent',?,?,1)").run(randomUUID(), q.id, kind, text);
  notify(reviewId);
  return { ok: true };
}

/** Interrupts the agent; threads it has not answered return to the queue so they can be sent again. */
export async function stop(projectId: string, reviewId: string) {
  ownReview(projectId, reviewId);
  // An interrupted review is not a finished one: the end of the cancelled turn must not mark it done.
  db().prepare("UPDATE branch_reviews SET analysis_status='stopped' WHERE id=? AND analysis_status='running'").run(reviewId);
  for (const t of db().prepare('SELECT session_id FROM mr_private_threads WHERE review_id=?').all(reviewId) as { session_id: string }[]) await cancelSession(t.session_id).catch(() => undefined);
  const { questions } = list(projectId, reviewId);
  db().transaction(() => {
    for (const q of questions.filter(x => awaiting(x.id))) {
      const last = thread(q.id).at(-1)!;
      db().prepare('UPDATE branch_question_messages SET sent=0 WHERE id=?').run(last.id);
    }
  })();
  notify(reviewId);
  return list(projectId, reviewId);
}
