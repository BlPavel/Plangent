import { DomainError } from '../../../models/domain-error';
import { parsePlanSteps } from '../../preparation';
import type { PlanSaved } from '../../preparation';
import { materialBlocks, parseMaterialIdentifiers } from '../../preparation';
import type { MaterialSaved } from '../../preparation';
import type { PlanRemark, PlanReview, RemarkKind, RemarkStatus, ReviewTarget, StepRef } from '../../../models/plan-review';

export const kinds = ['contradiction', 'order', 'coverage', 'extra', 'unclear', 'risk'] as const;
/** A material has no order of steps; a suggestion is an improvement, kept apart from a violation of a requirement or rule. */
export const materialKinds = ['contradiction', 'coverage', 'extra', 'unclear', 'risk', 'suggestion'] as const;
export const kindsOf = (target: ReviewTarget): readonly RemarkKind[] => target === 'plan' ? kinds : materialKinds;
export function text(value: unknown, required = true): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 100000 || (required && !value.trim())) throw new DomainError('Invalid text');
  return value.trim();
}
export function stepIds(value: unknown, content: string): string[] {
  const known = new Set(parsePlanSteps(content).map(s => s.id));
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !known.has(id))) throw new DomainError('Unknown plan step');
  return [...new Set(value)] as string[];
}
/** The places a card of the review points at: plan steps for a plan, decision and criterion identifiers for a material. */
export function referenceIds(target: ReviewTarget, value: unknown, content: string): string[] {
  if (target === 'plan') return stepIds(value, content);
  const known = new Set(parseMaterialIdentifiers(content));
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !known.has(id))) throw new DomainError('Unknown identifier of the document');
  return [...new Set(value)] as string[];
}
const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
/** A quote of the document that marks the place of a card without an identifier; it must really be there. */
export function quoteOf(value: unknown, content: string): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 2000) throw new DomainError('Invalid quote');
  const quote = squash(value);
  if (quote && !squash(content).includes(quote)) throw new DomainError('The quote is not in the document');
  return quote;
}
export function decide(r: PlanRemark, status: unknown, comment: unknown): PlanRemark {
  if (!['open', 'accepted', 'discussing', 'rejected'].includes(String(status))) throw new DomainError('Invalid decision');
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
/**
 * A card of a material follows its decisions and criteria: an identifier that vanished is marked deleted, and the card is outdated
 * when the text it points at changed (the whole document when it points at nothing).
 */
export function remapMaterialRemark(r: PlanRemark, review: PlanReview, event: MaterialSaved): PlanRemark {
  const before = materialBlocks(event.previousContent), after = materialBlocks(event.content);
  const steps = r.steps.map(ref => ref.deleted ? ref : { ...ref, deleted: !after.has(ref.id) });
  const changed = r.steps.length
    ? r.steps.some((ref, i) => !ref.deleted && (steps[i].deleted || before.get(ref.id) !== after.get(ref.id)))
    : r.quote ? !squash(event.content).includes(r.quote) : event.previousContent !== event.content;
  const applied = r.status === 'sent' && r.sent_status === 'accepted' && !!event.sessionId && event.sessionId === r.planner_session_id && review.plan_content !== event.content;
  return { ...r, steps, outdated: r.outdated || changed,
    status: applied ? 'applied' : r.status, applied_version: applied ? event.version : r.applied_version };
}
