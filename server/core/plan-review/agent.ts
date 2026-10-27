import { CodeError } from '../code/files';
import { stepIds, text } from './remarks';
import type { Coverage, PlanReview, PlanRemark } from './types';

/** Validate overview and coverage against this review snapshot. */
export function overview(review: PlanReview, remarks: PlanRemark[], input: Record<string, unknown>): PlanReview {
  if (!Array.isArray(input.coverage)) throw new CodeError('Invalid coverage');
  const coverage: Coverage[] = input.coverage.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new CodeError('Invalid coverage row');
    const r = row as Record<string, unknown>;
    if (!['covered', 'missing', 'partial'].includes(String(r.status))) throw new CodeError('Invalid coverage status');
    const card = r.remark_id === undefined ? undefined : remarks.find(m => m.id === r.remark_id);
    if ((r.status !== 'covered' || r.remark_id !== undefined) && !card) throw new CodeError('Coverage problem needs a remark');
    return { requirement: text(r.requirement), steps: stepIds(r.steps, review.plan_content),
      status: r.status as Coverage['status'], ...(card ? { remark_id: card.id } : {}) };
  });
  return { ...review, overview: text(input.overview), coverage };
}

export { PROTOCOL, brief, reviewerScope, reviewerOutput, launch } from './reviewer';
