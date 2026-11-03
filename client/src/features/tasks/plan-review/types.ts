/** What a review looks at: the plan or one of the preparation documents. */
export type ReviewTarget = 'plan' | 'architecture' | 'qa'
export interface Coverage { requirement: string; steps: string[]; status: 'covered' | 'missing' | 'partial'; remark_id?: string; source?: 'analysis' | 'qa'; criterion?: string }
export interface Review {
  id: string; task_id: string; target: ReviewTarget; plan_version: number; round: number; session_id: string | null;
  skill_id: string | null; overview: string; coverage: Coverage[]; status: 'open' | 'completed' | 'failed'
}
export interface Remark {
  /** steps: pN of a plan, D…/Q… of a document; quote marks a place of a document that has no identifier. */
  id: string; steps: { id: string; deleted: boolean }[]; quote?: string; kind: 'contradiction' | 'order' | 'coverage' | 'extra' | 'unclear' | 'risk' | 'suggestion';
  text: string; suggestion: string; status: 'open' | 'accepted' | 'discussing' | 'rejected' | 'sent' | 'applied' | 'answered';
  decision: string; original: { text: string; suggestion: string } | null; outdated: boolean; applied_version: number | null; planner_session_id?: string | null;
  messages: { id: string; author: 'developer' | 'reviewer' | 'planner'; text: string; sent: boolean }[]
}
export interface Detail { review: Review; remarks: Remark[] }
export interface Skill { id: string; title: string; origin: 'direct' | 'group' | 'global' }
export interface Launch { agent_id: string; model?: string; reasoning_effort?: string; skill_id?: string; wish?: string }

