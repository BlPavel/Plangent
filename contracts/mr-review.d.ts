import type { MergeRequest, MrVersion, MrDiff, DiffPosition, HostDiscussion, HostCapabilities } from './index';
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
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type MrReviewGETResponse = {
    "requests": (C.ReviewRequest)[];
    "errors": ({
        "project_id": string;
        "message": string;
    })[];
};
export type MrReviewPOSTOpenBody = {
    url?: string;
    project_id?: string;
    iid?: number;
};
export type MrReviewPOSTIdRefreshBody = {
    version?: number;
};
export type MrReviewGETIdThreadsResponse = ({
    "id": string;
    "review_id": string;
    "head": string;
    "path": string;
    "side": string;
    "line": number;
    "session_id": string;
})[];
export type MrReviewPOSTIdThreadsResponse = {
    "id": string;
    "review_id": string;
    "head": string;
    "path": string;
    "side": string;
    "line": number;
    "session_id": string;
};
export type MrReviewPOSTIdThreadsBody = {
    path: string;
    side: 'old' | 'new';
    line: number;
    head: string;
};
export type MrReviewPOSTIdFinishResponse = {
    "finished": boolean;
};
export type MrReviewGETIdFileResponse = {
    "content": string;
};
export type MrReviewPOSTIdDraftsBody = {
    body: string;
    path?: string;
    side?: 'old' | 'new';
    line?: number;
    head?: string;
};
export type MrReviewPATCHIdDraftsDraftBody = {
    body: string;
};
export type MrReviewPOSTIdDraftsDraftRecoverBody = {
    published: boolean;
    confirmed: boolean;
};
export type MrReviewPOSTIdPublishBody = {
    ids: string[];
    confirmed: boolean;
};
export type MrReviewPOSTIdDiscussionsDiscussionReplyBody = {
    body: string;
};
export type MrReviewPOSTIdApproveBody = {
    approved: boolean;
};
export type MrReviewPUTIdViewedBody = {
    path: string;
    viewed: boolean;
};
export interface MrReviewEndpoints {
    "GET /api/projects/:projectId/mr-review": Endpoint<"GET /api/projects/:projectId/mr-review", never, MrReviewGETResponse, {
        "q"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/mr-review/open": Endpoint<"POST /api/projects/:projectId/mr-review/open", MrReviewPOSTOpenBody, C.MrDetail, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/mr-review/:id": Endpoint<"GET /api/projects/:projectId/mr-review/:id", never, C.MrDetail, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/refresh": Endpoint<"POST /api/projects/:projectId/mr-review/:id/refresh", MrReviewPOSTIdRefreshBody, C.MrDetail, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/mr-review/:id/threads": Endpoint<"GET /api/projects/:projectId/mr-review/:id/threads", never, MrReviewGETIdThreadsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/threads": Endpoint<"POST /api/projects/:projectId/mr-review/:id/threads", MrReviewPOSTIdThreadsBody, MrReviewPOSTIdThreadsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/finish": Endpoint<"POST /api/projects/:projectId/mr-review/:id/finish", never, MrReviewPOSTIdFinishResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/mr-review/:id/file": Endpoint<"GET /api/projects/:projectId/mr-review/:id/file", never, MrReviewGETIdFileResponse, {
        "head"?: string;
        "path"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/drafts": Endpoint<"POST /api/projects/:projectId/mr-review/:id/drafts", MrReviewPOSTIdDraftsBody, C.MrDraft, Record<string, never>, "json", never>;
    "PATCH /api/projects/:projectId/mr-review/:id/drafts/:draft": Endpoint<"PATCH /api/projects/:projectId/mr-review/:id/drafts/:draft", MrReviewPATCHIdDraftsDraftBody, C.MrDetail, Record<string, never>, "json", never>;
    "DELETE /api/projects/:projectId/mr-review/:id/drafts/:draft": Endpoint<"DELETE /api/projects/:projectId/mr-review/:id/drafts/:draft", never, C.MrDetail, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/drafts/:draft/recover": Endpoint<"POST /api/projects/:projectId/mr-review/:id/drafts/:draft/recover", MrReviewPOSTIdDraftsDraftRecoverBody, C.MrDetail, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/publish": Endpoint<"POST /api/projects/:projectId/mr-review/:id/publish", MrReviewPOSTIdPublishBody, C.MrDetail, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/discussions/:discussion/reply": Endpoint<"POST /api/projects/:projectId/mr-review/:id/discussions/:discussion/reply", MrReviewPOSTIdDiscussionsDiscussionReplyBody, C.MrDetail, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/mr-review/:id/approve": Endpoint<"POST /api/projects/:projectId/mr-review/:id/approve", MrReviewPOSTIdApproveBody, C.MrDetail, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/mr-review/:id/viewed": Endpoint<"PUT /api/projects/:projectId/mr-review/:id/viewed", MrReviewPUTIdViewedBody, C.MrDetail, Record<string, never>, "json", never>;
}
