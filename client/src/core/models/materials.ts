/** Preparation documents of a task besides the analysis and the plan. */
export type MaterialType = 'architecture' | 'qa'
export interface Material {
  id: string; task_id: string; type: MaterialType; content: string; version: number
  author: 'developer' | 'agent'; session_id: string | null; created_at: string
}
export type PreparationStage = 'analysis' | 'architecture' | 'qa' | 'plan'
/** not_started and draft are derived from the material; ready and skipped are marked by the developer only. */
export interface StageSummary {
  stage: PreparationStage; status: 'not_started' | 'draft' | 'ready' | 'skipped'
  material_version: string; marked_version: string | null; marked_at: string | null; changed_since_mark: boolean
}
