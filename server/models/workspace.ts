export interface Workspace {
  id: string;
  project_id: string;
  task_id: string;
  branch: string;
  base_branch: string;
  path: string;
  status: 'preparing' | 'ready' | 'failed' | 'removed';
  error: string;
  setup_log: string;
  created_at: string;
  removed_at: string | null;
}
