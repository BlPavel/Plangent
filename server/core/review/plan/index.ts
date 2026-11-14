import { createPlanReviewRepository } from '../../../infrastructure/db/repositories/review/plan/service-repository';
import { reviewTransition } from '../kernel';
import { DomainError } from '../../../models/domain-error';
import { broadcast } from '../../shared';
import { onPlanSaved, type PlanSaved } from '../../preparation';
import { parseMaterialIdentifiers } from '../../preparation';
import { onMaterialSaved, type MaterialSaved } from '../../preparation';

import { kindsOf, referenceIds, quoteOf, text, decide, remapRemark, remapMaterialRemark } from './remarks';
import { overview } from './overview';
import { markSent, markAnswered } from './planner';
import type { PlanReview, PlanRemark, PlanMessage, ReviewTarget } from '../../../models/plan-review';

export * from '../../../models/plan-review';
export const reviewTargets: readonly ReviewTarget[] = ['plan', 'architecture', 'qa'];
export function isReviewTarget(value: unknown): value is ReviewTarget { return reviewTargets.includes(value as ReviewTarget); }
export function createPlanReviewService(records = createPlanReviewRepository()) {
  const { store } = records;
  const queries = records;
  function task(projectId: string, taskId: string) {
    if (!queries.taskSelectTasks(taskId, projectId)) throw new DomainError('Task not found', 404);
  }
  function scoped(projectId: string, taskId: string, id: string) {
    task(projectId, taskId);
    const r = store.getReview(id);
    if (!r || r.task_id !== taskId) throw new DomainError('Plan review not found', 404);
    return r;
  }
  function card(id: string, key: string) {
    const r = store.remarks(id).find(r => r.id === key);
    if (!r) throw new DomainError('Plan remark not found', 404);
    return r;
  }
  function notify(taskId: string, id?: string) { broadcast({ type: 'plan_review_updated', taskId, reviewId: id }); }
  function detail(projectId: string, taskId: string, id: string) {
    const review = scoped(projectId, taskId, id);
    return { review, remarks: store.remarks(id).map(r => ({ ...r, messages: store.messages(r.id) })) };
  }
  function list(projectId: string, taskId: string, target: ReviewTarget = 'plan') { task(projectId, taskId); return store.listReviews(taskId, target); }
  /** The persisted text of what is reviewed, never a caller-provided snapshot. */
  function current(taskId: string, target: ReviewTarget): { content: string; version: number } | undefined {
    if (target === 'plan') return queries.currentSelectPlans(taskId) as { content: string; version: number } | undefined;
    return queries.currentSelectMaterials(taskId, target) as { content: string; version: number } | undefined;
  }
  /** Q… identifiers of the QA the developer marked ready: only a ready QA is a ground of the plan review. */
  function readyCriteria(taskId: string): string[] {
    const ready = queries.readySelectPreparationMarks(taskId);
    const qa = ready ? current(taskId, 'qa') : undefined;
    return qa ? parseMaterialIdentifiers(qa.content).filter(id => id.startsWith('Q')) : [];
  }
  function create(projectId: string, taskId: string, input: { session_id?: string | null; skill_id?: string | null; target?: ReviewTarget } = {}) {
    task(projectId, taskId);
    const { target = 'plan', ...rest } = input;
    if (!isReviewTarget(target)) throw new DomainError('Invalid review target');
    const plan = current(taskId, target);
    if (!plan) throw new DomainError(target === 'plan' ? 'Plan not found' : 'Nothing to review: the document does not exist yet', 409);
    const hasQueue = queries.hasQueueSelectSqliteMaster();
    const queue = hasQueue ? queries.queueSelectTaskQueues(taskId) as { data: string } | undefined : undefined;
    if (queue && ['running', 'paused'].includes(JSON.parse(queue.data).status)) throw new DomainError((target === 'plan' ? 'Plan' : 'Document') + ' is frozen while the queue is running', 409);
    const r = store.createReview({ task_id: taskId, target, plan_content: plan.content, plan_version: plan.version, ...rest });
    notify(taskId, r.id);
    return detail(projectId, taskId, r.id);
  }
  function addRemark(projectId: string, taskId: string, id: string, input: Record<string, unknown>) {
    const r = scoped(projectId, taskId, id);
    if (r.status !== 'open') throw new DomainError('Review is closed', 409);
    if (!kindsOf(r.target).includes(input.kind as PlanRemark['kind'])) throw new DomainError('Invalid remark kind');
    const steps = referenceIds(r.target, input.steps ?? [], r.plan_content).map(id => ({ id, deleted: false }));
    const quote = r.target === 'plan' ? '' : quoteOf(input.quote, r.plan_content);
    const result = store.addRemark({ review_id: id, steps, kind: input.kind as PlanRemark['kind'],
      text: text(input.text), suggestion: text(input.suggestion, false), quote });
    // A late reviewer output for an old snapshot is visibly stale too.
    const latest = current(taskId, r.target);
    if (latest && latest.content !== r.plan_content) {
      result.outdated = true;
      store.saveRemark(result);
    }
    notify(taskId, id);
    return result;
  }
  function setOverview(projectId: string, taskId: string, id: string, input: Record<string, unknown>) {
    const r = scoped(projectId, taskId, id);
    if (r.status !== 'open') throw new DomainError('Review is closed', 409);
    store.saveReview(overview(r, store.remarks(id), input, r.target === 'plan' ? readyCriteria(taskId) : []));
    notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function setStatus(projectId: string, taskId: string, id: string, status: PlanReview['status']) {
    const r = scoped(projectId, taskId, id);
    if (!['open', 'completed', 'failed'].includes(status)) throw new DomainError('Invalid review status');
    const next = status === 'completed' && r.status !== status
      ? reviewTransition(r.status, 'report', { idle: 'open', running: 'open', reported: 'completed' }) : status;
    store.saveReview({ ...r, status: next }); notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function decision(projectId: string, taskId: string, id: string, key: string, input: Record<string, unknown>) {
    scoped(projectId, taskId, id);
    const result = decide(card(id, key), input.status, input.comment);
    records.transaction(() => {
      store.saveRemark(result);
      if (result.decision) store.addMessage(key, 'developer', result.decision);
    });
    notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  /** The card is rewritten (by the reviewer after a discussion, or by the developer): the first version stays in `original`. */
  function revise(projectId: string, taskId: string, id: string, key: string, input: Record<string, unknown>) {
    scoped(projectId, taskId, id);
    const r = card(id, key);
    if (r.status === 'sent' || r.status === 'applied') throw new DomainError('The card already went to the planner', 409);
    const next = text(input.text), suggestion = text(input.suggestion, false);
    if (next !== r.text || suggestion !== r.suggestion) {
      store.saveRemark({ ...r, text: next, suggestion, original: r.original ?? { text: r.text, suggestion: r.suggestion } });
      notify(taskId, id);
    }
    return detail(projectId, taskId, id);
  }
  function addMessage(projectId: string, taskId: string, id: string, key: string, author: PlanMessage['author'], value: unknown) {
    scoped(projectId, taskId, id);
    const r = card(id, key);
    if (!['developer', 'reviewer', 'planner'].includes(author)) throw new DomainError('Invalid message author');
    const body = text(value);
    records.transaction(() => {
      if (author === 'planner') store.saveRemark(markAnswered(r, body));
      store.addMessage(key, author, body, author !== 'developer');
    });
    notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function sent(projectId: string, taskId: string, id: string, keys: string[], sessionId: string) {
    scoped(projectId, taskId, id);
    if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || !sessionId) throw new DomainError('Invalid delivery');
    const selected = keys.map(key => ({ ...markSent(card(id, key)), planner_session_id: sessionId }));
    records.transaction(() => {
      for (const r of selected) {
        store.saveRemark(r);
        queries.sentUpdatePlanReviewMessages(r.id);
      }
    });
    notify(taskId, id);
  }
  /** The developer's comments in a card reached the reviewer. */
  function delivered(projectId: string, taskId: string, id: string, keys: string[]) {
    scoped(projectId, taskId, id);
    for (const key of keys) queries.deliveredUpdatePlanReviewMessages(key);
    notify(taskId, id);
    return detail(projectId, taskId, id);
  }
  function onSaved(event: PlanSaved) {
    records.transaction(() => {
      for (const r of store.listReviews(event.taskId, 'plan')) {
        for (const remark of store.remarks(r.id)) store.saveRemark(remapRemark(remark, r, event));
      }
    });
    if (store.listReviews(event.taskId, 'plan').length) notify(event.taskId);
  }
  function onMaterialChanged(event: MaterialSaved) {
    records.transaction(() => {
      for (const r of store.listReviews(event.taskId, event.type)) {
        for (const remark of store.remarks(r.id)) store.saveRemark(remapMaterialRemark(remark, r, event));
      }
    });
    if (store.listReviews(event.taskId, event.type).length) notify(event.taskId);
  }
  return { list, create, readyCriteria, detail, addRemark, setOverview, setStatus, decision, addMessage, revise, sent, delivered, onSaved, onMaterialChanged };
}
let service: ReturnType<typeof createPlanReviewService> | undefined;
export const planReviews = () => service ??= createPlanReviewService();
// Subscribe once when the public module is loaded by HTTP/MCP; orchestration and materials never import this module.
onPlanSaved(event => planReviews().onSaved(event));
onMaterialSaved(event => planReviews().onMaterialChanged(event));
