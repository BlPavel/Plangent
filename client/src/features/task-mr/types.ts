export interface MrPreview {
  head: string; task_id?: string; connection_id: string; project_path: string;
  source_branch: string; target_branch: string; title: string; description: string;
  reviewer_ids: number[]; reviewer_logins?: string[]; remove_source_branch: boolean; squash: boolean;
}
export interface TaskMr { iid: number; web_url: string; state: string; source_branch?: string; target_branch?: string }
