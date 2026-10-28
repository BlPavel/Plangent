import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../../infrastructure/db/schema';
import type { PlanReview, PlanRemark, PlanMessage } from './types';

type ReviewRow = Omit<PlanReview, 'coverage'> & { coverage: string };
type RemarkRow = Omit<PlanRemark, 'steps' | 'outdated' | 'original'> & { steps: string; outdated: number; original: string | null };
type MessageRow = Omit<PlanMessage, 'sent'> & { sent: number };
const review = (r: ReviewRow): PlanReview => ({ ...r, coverage: JSON.parse(r.coverage) });
const remark = (r: RemarkRow): PlanRemark => ({ ...r, steps: JSON.parse(r.steps), outdated: !!r.outdated, original: r.original ? JSON.parse(r.original) : null });
const message = (r: MessageRow): PlanMessage => ({ ...r, sent: !!r.sent });

/** Persistence only. Scope validation and lifecycle rules belong to the service. */
export function createPlanReviewStore(db: Database.Database = getDb()) {
  const getReview = (id: string) => {
    const r = db.prepare('SELECT * FROM plan_reviews WHERE id=?').get(id) as ReviewRow | undefined;
    return r ? review(r) : null;
  };
  const listReviews = (taskId: string) => (db.prepare('SELECT * FROM plan_reviews WHERE task_id=? ORDER BY round DESC').all(taskId) as ReviewRow[]).map(review);
  const remarks = (id: string) => (db.prepare('SELECT * FROM plan_review_remarks WHERE review_id=? ORDER BY created_at,rowid').all(id) as RemarkRow[]).map(remark);
  const messages = (id: string) => (db.prepare('SELECT * FROM plan_review_messages WHERE remark_id=? ORDER BY created_at,rowid').all(id) as MessageRow[]).map(message);
  function createReview(data: Pick<PlanReview, 'task_id' | 'plan_version' | 'plan_content'> & Partial<Pick<PlanReview, 'session_id' | 'skill_id'>>) {
    const id = randomUUID();
    db.prepare(`INSERT INTO plan_reviews(id,task_id,plan_version,plan_content,round,session_id,skill_id)
      VALUES (?,?,?,?,(SELECT coalesce(max(round),0)+1 FROM plan_reviews WHERE task_id=?),?,?)`)
      .run(id, data.task_id, data.plan_version, data.plan_content, data.task_id, data.session_id ?? null, data.skill_id ?? null);
    return getReview(id)!;
  }
  function saveReview(r: PlanReview) {
    db.prepare('UPDATE plan_reviews SET session_id=?,skill_id=?,overview=?,coverage=?,status=? WHERE id=?')
      .run(r.session_id, r.skill_id, r.overview, JSON.stringify(r.coverage), r.status, r.id);
  }
  function addRemark(data: Pick<PlanRemark, 'review_id' | 'steps' | 'kind' | 'text' | 'suggestion'>) {
    const id = randomUUID();
    db.prepare('INSERT INTO plan_review_remarks(id,review_id,steps,kind,text,suggestion) VALUES (?,?,?,?,?,?)')
      .run(id, data.review_id, JSON.stringify(data.steps), data.kind, data.text, data.suggestion);
    return remarks(data.review_id).find(r => r.id === id)!;
  }
  function saveRemark(r: PlanRemark) {
    db.prepare(`UPDATE plan_review_remarks SET steps=?,text=?,suggestion=?,original=?,status=?,decision=?,sent_status=?,outdated=?,applied_version=?,planner_session_id=? WHERE id=?`)
      .run(JSON.stringify(r.steps), r.text, r.suggestion, r.original ? JSON.stringify(r.original) : null, r.status, r.decision, r.sent_status, Number(r.outdated), r.applied_version, r.planner_session_id, r.id);
  }
  function addMessage(remarkId: string, author: PlanMessage['author'], text: string, sent = false) {
    const id = randomUUID();
    db.prepare('INSERT INTO plan_review_messages(id,remark_id,author,text,sent) VALUES (?,?,?,?,?)').run(id, remarkId, author, text, Number(sent));
    return messages(remarkId).find(m => m.id === id)!;
  }
  return { getReview, listReviews, createReview, saveReview, remarks, messages, addRemark, saveRemark, addMessage };
}
