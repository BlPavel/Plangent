export interface HostUser {
  id: number;
  name: string;
  username: string;
}
export interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}
export interface MergeRequest {
  iid: number;
  title: string;
  description: string;
  web_url: string;
  state: string;
  author: HostUser;
  source_branch: string;
  target_branch: string;
  sha: string;
  updated_at: string;
  diff_refs: DiffRefs;
}
export interface MrVersion {
  id: number;
  base_commit_sha: string;
  start_commit_sha: string;
  head_commit_sha: string;
  created_at: string;
}
export interface MrDiff {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
  too_large?: boolean;
  collapsed?: boolean;
}
export interface DiffPosition extends DiffRefs {
  position_type: 'text';
  old_path: string;
  new_path: string;
  old_line?: number | null;
  new_line?: number | null;
}
export interface HostNote {
  id: number;
  body: string;
  author: HostUser;
  position?: DiffPosition;
  system?: boolean;
  resolved?: boolean;
}
export interface HostDiscussion {
  id: string;
  notes: HostNote[];
}
export interface HostCapabilities {
  batchReview: boolean | null;
  approve: boolean | null;
}
