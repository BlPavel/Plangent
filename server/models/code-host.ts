/** Hosting contracts: authentication belongs to integrations, not providers. */
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
/** Who approved a merge request and how many approvals its rules still need (null: the host does not say). */
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
/** Someone who can be asked to review: `value` is what the host expects in `reviewer_ids` (GitLab id) or `reviewer_logins` (GitHub login). */
export interface HostMember {
    value: string;
    login: string;
    name: string;
}
export interface CodeHost {
    readonly capabilities: HostCapabilities;
    getMergeRequest(iid: number): Promise<MergeRequest>;
    listReviewRequests(): Promise<MergeRequest[]>;
    listOpenMergeRequests(): Promise<MergeRequest[]>;
    /** Null when approvals are not available on this host or for this account. */
    getApprovals(iid: number): Promise<HostApprovals | null>;
    searchMergeRequests(query: string): Promise<MergeRequest[]>;
    getVersions(iid: number): Promise<MrVersion[]>;
    getDiff(iid: number, version?: number): Promise<MrDiff[]>;
    getFile(path: string, ref: string): Promise<string>;
    listDiscussions(iid: number): Promise<HostDiscussion[]>;
    createDiscussion(iid: number, note: ReviewNote): Promise<HostDiscussion>;
    replyToDiscussion(iid: number, discussion: string, body: string): Promise<HostNote>;
    resolveDiscussion(iid: number, discussion: string, resolved: boolean): Promise<void>;
    updateNote(iid: number, discussion: string, note: number, body: string): Promise<void>;
    deleteNote(iid: number, discussion: string, note: number): Promise<void>;
    currentUser(): Promise<HostUser>;
    detectCapabilities(iid: number): Promise<HostCapabilities>;
    createDraftNotes(iid: number, notes: ReviewNote[], created: (index: number, id: number) => void): Promise<void>;
    publishDrafts(iid: number, ids: number[], published: (id: number) => void): Promise<void>;
    updateDraft(iid: number, id: number, note: ReviewNote): Promise<void>;
    deleteDraft(iid: number, id: number): Promise<void>;
    approve(iid: number, sha: string): Promise<void>;
    unapprove(iid: number): Promise<void>;
    createMergeRequest(input: CreateMergeRequest): Promise<MergeRequest>;
    listMembers(): Promise<HostMember[]>;
    findMergeRequestForBranch(branch: string): Promise<MergeRequest | null>;
    mergeRequestRef(iid: number): string;
}
