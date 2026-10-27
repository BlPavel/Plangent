import type Database from 'better-sqlite3';
import { getDb } from '../../infrastructure/db/schema';
import { CodeError } from '../code/files';
import { broadcast } from '../shared/events';
import { onPlanSaved, type PlanSaved } from '../orchestration/plan-events';
import { createPlanReviewStore } from './store';
import { kinds, stepIds, text, decide, remapRemark } from './remarks';
import { overview } from './agent';
import { markSent, markAnswered } from './planner';
import type { PlanReview, PlanRemark, PlanMessage } from './types';

export * from './types';
export function createPlanReviewService(db: Database.Database = getDb()) {
  const store = createPlanReviewStore(db);
  function task(projectId: string, taskId: string) {
    if (!db.prepare('SELECT 1 FROM tasks WHERE id=? AND project_id=?').get(taskId, projectId)) throw new CodeError('Task not found', 404);
  }
  function scoped(projectId: string, taskId: string, id: string) {
    task(projectId, taskId);
    const r = store.getReview(id);
    if (!r || r.task_id !== taskId) throw new CodeError('Plan review not found', 404);
    return r;
  }
  function card(id: string, key: string) {
    const r = store.remarks(id).find(r => r.id === key);
    if (!r) throw new CodeError('Plan remark not found', 404);
    return r;
  }
  function notify(taskId: string, id?: string) { broadcast({ type: 'plan_review_updated', taskId, reviewId: id }); }
  function detail(projectId: string, taskId: string, id: string) {
    const review = scoped(projectId, taskId, id);
    return { review, remarks: store.remarks(id).map(r => ({ ...r, messages: store.messages(r.id) })) };
  }
  function list(projectId: string, taskId: string) { task(projectId, taskId); return store.listReviews(taskId); }
  function create(projectId: string, taskId: string, input: { session_id?: string | null; skill_id?: string | null } = {}) {
    task(projectId, taskId);
    // Read the persisted plan, never a caller-provided snapshot.
    const plan = db.prepare('SELECT content,version FROM plans WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId) as { content: string; version: number } | undefined;
    if (!plan) throw new CodeError('Plan not found', 409);
    const hasQueue = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_queues'").get();
    const queue = hasQueue ? db.prepare('SELECT data FROM task_queues WHERE task_id=?').get(taskId) as { data: string } | undefined : undefined;
    if (queue && ['running', 'paused'].includes(JSON.parse(queue.data).status)) throw new CodeError('Plan is frozen while the queue is running', 409);
    const r = store.createReview({ task_id: taskId, plan_content: plan.content, plan_version: plan.version, ...input });
    notify(taskId, r.id);
    return detail(projectId, taskId, r.id);
  }
  function addRemark(projectId: string, taskId: string, id: string, input: Record<string, unknown>) {
    const r = scoped(projectId, taskId, id);
    if (r.status !== 'open') throw new CodeError('Review is closed', 409);
    if (!kinds.includes(input.kind as typeof kinds[number])) throw new CodeError('Invalid remark kind');
    const steps = stepIds(input.steps ?? [], r.plan_content).map(id => ({ id, deleted: false }));
    const result = store.addRemark({ review_id: id, steps, kind: input.kind as PlanRemark['kind'],
      text: text(input.text), suggestion: text(input.suggestion, false) });
    // A late reviewer output for an old snapshot is visibly stale too.
    const current = db.prepare('SELECT content FROM plans WHERE task_id=? ORDER BY version DESC LIMIT 1').get(taskId) as { content: string } | undefined;
    if (current && current.content !== r.plan_content) {
      result.outdated = true;
      store.saveRemark(result);
    }
    notify(taskId, id);
    return result;
  }
  function setOverview(projectId: string, taskId: string, id: string, input: Record<string, unknown>) {
    const r = scoped(projectId, taskId, id);
    if (r.status !== 'open') throw new CodeError('Review is closed', 409);
    store.saveReview(overview(r, store.remarks(id), input));
    notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function setStatus(projectId: string, taskId: string, id: string, status: PlanReview['status']) {
    const r = scoped(projectId, taskId, id);
    if (!['open', 'completed', 'failed'].includes(status)) throw new CodeError('Invalid review status');
    store.saveReview({ ...r, status }); notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function decision(projectId: string, taskId: string, id: string, key: string, input: Record<string, unknown>) {
    scoped(projectId, taskId, id);
    const result = decide(card(id, key), input.status, input.comment);
    db.transaction(() => {
      store.saveRemark(result);
      if (result.decision) store.addMessage(key, 'developer', result.decision);
    })();
    notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function addMessage(projectId: string, taskId: string, id: string, key: string, author: PlanMessage['author'], value: unknown) {
    scoped(projectId, taskId, id);
    const r = card(id, key);
    if (!['developer', 'reviewer', 'planner'].includes(author)) throw new CodeError('Invalid message author');
    const body = text(value);
    db.transaction(() => {
      if (author === 'planner') store.saveRemark(markAnswered(r, body));
      store.addMessage(key, author, body, author !== 'developer');
    })();
    notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function sent(projectId: string, taskId: string, id: string, keys: string[], sessionId: string) {
    scoped(projectId, taskId, id);
    if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || !sessionId) throw new CodeError('Invalid delivery');
    const selected = keys.map(key => ({ ...markSent(card(id, key)), planner_session_id: sessionId }));
    db.transaction(() => {
      for (const r of selected) {
        store.saveRemark(r);
        db.prepare('UPDATE plan_review_messages SET sent=1 WHERE remark_id=? AND sent=0').run(r.id);
      }
    })();
    notify(taskId, id);
  }
  function onSaved(event: PlanSaved) {
    db.transaction(() => {
      for (const r of store.listReviews(event.taskId)) {
        for (const remark of store.remarks(r.id)) store.saveRemark(remapRemark(remark, r, event));
      }
    })();
    if (store.listReviews(event.taskId).length) notify(event.taskId);
  }
  return { list, create, detail, addRemark, setOverview, setStatus, decision, addMessage, sent, onSaved };
}
let service: ReturnType<typeof createPlanReviewService> | undefined;
export const planReviews = () => service ??= createPlanReviewService();
// Subscribe once when the public module is loaded by HTTP/MCP; orchestration never imports this module.
onPlanSaved(event => planReviews().onSaved(event));
