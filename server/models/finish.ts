export type FinishScenario = 'nothing' | 'commits' | 'push' | 'full';
export type FinishStage = 'branch' | 'commits' | 'confirmation' | 'push' | 'mr' | 'done';
export type FinishStatus = 'running' | 'waiting' | 'error' | 'complete' | 'cancelled';
export interface FinishCommit { files: string[]; title: string; body?: string; sha?: string }
export interface FinishOptions {
  scenario: FinishScenario; task_id?: string; includeDescription?: boolean; includeCoauthors?: boolean;
  coauthors?: { name: string; email: string }[]; targetBranch?: string; branchName?: string;
}
export interface FinishRun {
  id: string; project_id: string; task_id: string | null; scenario: Exclude<FinishScenario, 'nothing'>;
  options: FinishOptions; base_head: string; branch: string; snapshot_tree: string;
  stage: FinishStage; status: FinishStatus; commits: FinishCommit[];
  session_id: string | null; note: string; error: string; output: string;
  pushed: boolean; mr_url: string | null; created_at: string; updated_at: string;
}
