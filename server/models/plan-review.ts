/** What a review looks at: the plan or one of the preparation documents. */
export type ReviewTarget = 'plan' | 'architecture' | 'qa';
export type RemarkKind = 'contradiction' | 'order' | 'coverage' | 'extra' | 'unclear' | 'risk' | 'suggestion';
export type RemarkStatus = 'open' | 'accepted' | 'discussing' | 'rejected' | 'sent' | 'applied' | 'answered';
/** A plan step (pN) or, in a review of a material, a decision or criterion (D…/Q…). */
export interface StepRef { id: string; deleted: boolean }
export interface Coverage {
  requirement: string;
  steps: string[];
  status: 'covered' | 'missing' | 'partial';
  remark_id?: string;
  /** Where the requirement comes from; a row without a source is an analysis requirement. */
  source?: 'analysis' | 'qa';
  /** The QA criterion (Q…) of a row whose source is qa. */
  criterion?: string;
}
export interface PlanReview {
  /** plan_version and plan_content hold the version and text of the reviewed document, whatever the target. */
  id: string; task_id: string; target: ReviewTarget; plan_version: number; plan_content: string; round: number;
  session_id: string | null; skill_id: string | null; overview: string; coverage: Coverage[];
  status: 'open' | 'completed' | 'failed'; created_at: string;
}
export interface PlanRemark {
  id: string; review_id: string; steps: StepRef[]; kind: RemarkKind; text: string; suggestion: string;
  /** The place of a material card that has no identifier: a quote from the document. */
  quote: string;
  status: RemarkStatus; decision: string; sent_status: 'accepted' | 'discussing' | null;
  planner_session_id: string | null; outdated: boolean; applied_version: number | null; created_at: string;
  /** The card as the reviewer first wrote it, kept when text or suggestion are rewritten after a discussion. */
  original: { text: string; suggestion: string } | null;
}
export interface PlanMessage {
  id: string; remark_id: string; author: 'developer' | 'reviewer' | 'planner';
  text: string; sent: boolean; created_at: string;
}
