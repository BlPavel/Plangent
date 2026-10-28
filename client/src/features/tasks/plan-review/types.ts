export interface Coverage { requirement: string; steps: string[]; status: 'covered' | 'missing' | 'partial'; remark_id?: string }
export interface Review {
  id: string; task_id: string; plan_version: number; round: number; session_id: string | null;
  skill_id: string | null; overview: string; coverage: Coverage[]; status: 'open' | 'completed' | 'failed'
}
export interface Remark {
  id: string; steps: { id: string; deleted: boolean }[]; kind: 'contradiction' | 'order' | 'coverage' | 'extra' | 'unclear' | 'risk';
  text: string; suggestion: string; status: 'open' | 'accepted' | 'discussing' | 'rejected' | 'sent' | 'applied' | 'answered';
  decision: string; original: { text: string; suggestion: string } | null; outdated: boolean; applied_version: number | null; planner_session_id?: string | null;
  messages: { id: string; author: 'developer' | 'reviewer' | 'planner'; text: string; sent: boolean }[]
}
export interface Detail { review: Review; remarks: Remark[] }
export interface Launch { agent_id: string; model?: string; reasoning_effort?: string; wish?: string }

