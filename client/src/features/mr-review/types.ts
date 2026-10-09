import type { MergeRequest, MrVersion, MrDiff, HostDiscussion, HostCapabilities, DiffPosition } from './host-types';
export interface MrSnapshot {
  mr: MergeRequest;
  versions: MrVersion[];
  version: MrVersion;
  files: MrDiff[];
  discussions: HostDiscussion[];
  capabilities: HostCapabilities;
}
export interface MrSession {
  id: string;
  project_id: string;
  connection_id: string;
  project_path: string;
  iid: number;
  snapshot: MrSnapshot;
  previous: MrSnapshot | null;
  updated_at: string;
}
export interface MrDraft {
  id: string;
  review_id: string;
  body: string;
  position: DiffPosition | null;
  remote_id: number | null;
  status: 'draft' | 'sent' | 'uncertain';
  error: string;
}
export interface MrDetail {
  session: MrSession;
  drafts: MrDraft[];
  viewed: string[];
  changed_files: string[];
  publication_error?: string;
}
export interface ReviewRequest {
  project_id: string;
  project_name: string;
  mr: MergeRequest;
  has_updates: boolean;
}
