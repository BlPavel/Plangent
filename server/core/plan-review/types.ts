export type RemarkKind = 'contradiction' | 'order' | 'coverage' | 'extra' | 'unclear' | 'risk';
export type RemarkStatus = 'open' | 'accepted' | 'discussing' | 'rejected' | 'sent' | 'applied' | 'answered';
export interface StepRef { id: string; deleted: boolean }
export interface Coverage {
  requirement: string;
  steps: string[];
  status: 'covered' | 'missing' | 'partial';
  remark_id?: string;
}
export interface PlanReview {
  id: string; task_id: string; plan_version: number; plan_content: string; round: number;
  session_id: string | null; skill_id: string | null; overview: string; coverage: Coverage[];
  status: 'open' | 'completed' | 'failed'; created_at: string;
}
export interface PlanRemark {
  id: string; review_id: string; steps: StepRef[]; kind: RemarkKind; text: string; suggestion: string;
  status: RemarkStatus; decision: string; sent_status: 'accepted' | 'discussing' | null;
  planner_session_id: string | null; outdated: boolean; applied_version: number | null; created_at: string;
}
export interface PlanMessage {
  id: string; remark_id: string; author: 'developer' | 'reviewer' | 'planner';
  text: string; sent: boolean; created_at: string;
}
