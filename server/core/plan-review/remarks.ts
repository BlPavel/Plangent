import { CodeError } from '../code/files';
import { parsePlanSteps } from '../orchestration/plans';
import type { PlanSaved } from '../orchestration/plan-events';
import type { PlanRemark, PlanReview, RemarkStatus, StepRef } from './types';

export const kinds = ['contradiction', 'order', 'coverage', 'extra', 'unclear', 'risk'] as const;
export function text(value: unknown, required = true): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 100000 || (required && !value.trim())) throw new CodeError('Invalid text');
  return value.trim();
}
export function stepIds(value: unknown, content: string): string[] {
  const known = new Set(parsePlanSteps(content).map(s => s.id));
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !known.has(id))) throw new CodeError('Unknown plan step');
  return [...new Set(value)] as string[];
}
export function decide(r: PlanRemark, status: unknown, comment: unknown): PlanRemark {
  if (!['open', 'accepted', 'discussing', 'rejected'].includes(String(status))) throw new CodeError('Invalid decision');
  // A sent or applied card may be reopened or discussed again: otherwise a planner that disagrees or never answers leaves it stuck.
  return { ...r, status: status as RemarkStatus, decision: text(comment, status === 'discussing'), sent_status: null, applied_version: null };
}
function blocks(content: string): Map<string, string> {
  const result = new Map<string, string>();
  let current: string | undefined;
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const step = parsePlanSteps(line)[0];
    if (step?.id) { current = step.id; result.set(current, step.text); }
    else if (current) result.set(current, result.get(current)! + '\n' + line);
  }
  return result;
}
/** Simultaneous mapping: p1 -> p2 and p2 -> p3 must never cascade. Deleted ids stay visibly deleted. */
export function remapRemark(r: PlanRemark, review: PlanReview, event: PlanSaved): PlanRemark {
  const before = blocks(event.previousContent), after = blocks(event.content);
  const remap = (ref: StepRef): StepRef => {
    if (ref.deleted) return ref;
    if (event.removedSteps?.includes(ref.id)) return { ...ref, deleted: true };
    const id = event.idMap[ref.id] ?? ref.id;
    return { id, deleted: !after.has(id) || (!event.idMap[ref.id] && Object.entries(event.idMap).some(([old, next]) => old !== ref.id && next === id)) };
  };
  const steps = r.steps.map(remap);
  const changed = r.steps.length
    ? r.steps.some((ref, i) => !ref.deleted && (steps[i].deleted || before.get(ref.id) !== after.get(steps[i].id)))
    : event.previousContent !== event.content;
  const applied = r.status === 'sent' && r.sent_status === 'accepted' && !!event.sessionId && event.sessionId === r.planner_session_id && review.plan_content !== event.content;
  return { ...r, steps, outdated: r.outdated || changed,
    status: applied ? 'applied' : r.status, applied_version: applied ? event.version : r.applied_version };
}
