import { CodeError } from '../code/files';
import type { PlanRemark } from './types';

/** Lifecycle helpers for the later planner transport. Call only after successful delivery. */
export function markSent(remark: PlanRemark): PlanRemark {
  if (remark.status !== 'accepted' && remark.status !== 'discussing') throw new CodeError('Remark is not ready to send', 409);
  return { ...remark, sent_status: remark.status, status: 'sent' };
}
export function markAnswered(remark: PlanRemark, text = ''): PlanRemark {
  if (remark.status === 'applied') return remark;
  if (remark.status !== 'sent') throw new CodeError('Remark was not sent', 409);
  // An answer to an accepted fix does not prove it was applied; a saved plan does.
  // A disagreement or a question about an accepted card needs the developer, so it counts as an answer too.
  return remark.sent_status === 'discussing' || /^(disagree|questions|options): /.test(text) ? { ...remark, status: 'answered' } : remark;
}
