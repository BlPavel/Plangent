import type { HostCapabilities, MergeRequest, HostApprovals, MrVersion, MrDiff, HostDiscussion, ReviewNote, HostNote, HostUser, CreateMergeRequest, HostMember } from '@contracts';
export type * from '@contracts';
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
