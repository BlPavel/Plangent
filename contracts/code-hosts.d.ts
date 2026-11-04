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
    created_at?: string;
    draft?: boolean;
    user_notes_count?: number;
    reviewers?: HostUser[];
}
export interface HostApprovals {
    approved_by: HostUser[];
    required: number | null;
    left: number | null;
    /** The connected account has approved. */
    mine: boolean;
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
    resolvable?: boolean;
    resolved?: boolean;
}
export interface HostDiscussion {
    id: string;
    notes: HostNote[];
}
export interface ReviewNote {
    body: string;
    position?: DiffPosition;
}
export interface HostCapabilities {
    batchReview: boolean | null;
    approve: boolean | null;
}
export interface CreateMergeRequest {
    source_branch: string;
    target_branch: string;
    title: string;
    description?: string;
    reviewer_ids?: number[];
    labels?: string;
    /** Logins for hosts that address reviewers by name (GitHub); numeric ids stay in reviewer_ids (GitLab). */
    reviewer_logins?: string[];
    /** Same split as the reviewers: GitLab ids in assignee_ids, GitHub logins in assignee_logins. */
    assignee_ids?: number[];
    assignee_logins?: string[];
    remove_source_branch?: boolean;
    squash?: boolean;
}
export interface HostMember {
    value: string;
    login: string;
    name: string;
}
