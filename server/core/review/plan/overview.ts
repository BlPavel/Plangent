import { DomainError } from '../../../models/domain-error';
import { stepIds, text } from './remarks';
import type { Coverage, PlanReview, PlanRemark } from '../../../models/plan-review';

/** Validate overview and coverage against this review snapshot. `criteria`: the Q… identifiers of the QA the developer marked ready. */
export function overview(review: PlanReview, remarks: PlanRemark[], input: Record<string, unknown>, criteria: string[] = []): PlanReview {
  // The coverage table belongs to the plan; a material has an overview only.
  if (review.target !== 'plan') {
    if (input.coverage !== undefined && (!Array.isArray(input.coverage) || input.coverage.length)) throw new DomainError('The coverage table exists only in a plan review');
    return { ...review, overview: text(input.overview), coverage: [] };
  }
  if (!Array.isArray(input.coverage)) throw new DomainError('Invalid coverage');
  const coverage: Coverage[] = input.coverage.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new DomainError('Invalid coverage row');
    const r = row as Record<string, unknown>;
    if (!['covered', 'missing', 'partial'].includes(String(r.status))) throw new DomainError('Invalid coverage status');
    const card = r.remark_id === undefined ? undefined : remarks.find(m => m.id === r.remark_id);
    if ((r.status !== 'covered' || r.remark_id !== undefined) && !card) throw new DomainError('Coverage problem needs a remark');
    const source = r.source;
    if (source !== undefined && source !== 'analysis' && source !== 'qa') throw new DomainError('Invalid coverage source');
    if ((source === 'qa') !== (r.criterion !== undefined)) throw new DomainError('A coverage row of QA needs source qa and its criterion, and only such a row');
    if (r.criterion !== undefined && (typeof r.criterion !== 'string' || !criteria.includes(r.criterion)))
      throw new DomainError('Unknown QA criterion: coverage rows name criteria of the ready QA only');
    const steps = stepIds(r.steps, review.plan_content);
    if (r.criterion !== undefined && r.status !== 'missing' && !steps.length) throw new DomainError(`Criterion ${r.criterion} is covered or partial but names no step`);
    return { requirement: text(r.requirement), steps, status: r.status as Coverage['status'], ...(card ? { remark_id: card.id } : {}),
      ...(source === 'qa' ? { source: 'qa' as const, criterion: r.criterion as string } : {}) };
  });
  const missing = criteria.filter(id => !coverage.some(row => row.criterion === id));
  if (missing.length) throw new DomainError(`The ready QA has criteria without a coverage row: ${missing.join(', ')}. Add a row for each (source qa, criterion Q…)`);
  return { ...review, overview: text(input.overview), coverage };
}

export { PROTOCOL, brief, reviewerScope, reviewerOutput, launch } from './reviewer';
