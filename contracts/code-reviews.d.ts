import type { Agent } from './index';
export interface CodeReviewLaunch {
    mode: 'worktree' | 'branch';
    ref?: string;
    agent_id?: string;
    model?: string;
    effort?: string;
    config?: Record<string, string>;
    skill_id?: string;
    /** What the agent should know about the changes and where to look closely (free text). */
    context?: string;
}
export interface CodeReviewPreview { base: string; branch: string | null; files: string[] }
export type CodeReviewStatus = 'open' | 'closed' | 'abandoned';
export type CodeReviewOrigin = 'project' | 'task';
export type CodeReviewItemStatus = 'draft' | 'sent' | 'done' | 'answered' | 'needs_decision' | 'rejected';
export interface CodeReview {
    id: string;
    /** Per-project display number: «Ревью #12». */
    number: number;
    project_id: string;
    branch: string | null;
    head_commit: string | null;
    status: CodeReviewStatus;
    origin: CodeReviewOrigin;
    origin_id: string;
    head_start: string;
    head_last: string;
    head_end: string | null;
    created_at: string;
    closed_at: string | null;
}
export interface CodeReviewRound {
    id: string;
    review_id: string;
    n: number;
    snapshot_tree: string;
    // Agent sessions have their own lifecycle; deleting a chat must preserve review history.
    session_id: string | null;
    sent_at: string;
}
export interface CodeReviewItem {
    id: string;
    review_id: string;
    round_id: string | null;
    author: 'developer' | 'agent';
    origin?: CodeReviewOrigin;
    origin_id?: string | null;
    task_key?: string | null;
    scope: 'line' | 'file' | 'general';
    file: string | null;
    line_start: number | null;
    line_end: number | null;
    side: 'new' | 'old';
    kind: 'fix' | 'question';
    text: string;
    refs: string[];
    code_snippet: string;
    comparison_base?: string | null;
    status: CodeReviewItemStatus;
    answer: string | null;
    outdated: boolean;
    /** The developer closed the thread (accepted, answered or rejected); writing to it reopens it. */
    closed: boolean;
    carried_from_item_id: string | null;
    created_at: string;
    updated_at: string;
}
export type CodeReviewMessageKind = 'text' | 'implement' | 'answer' | 'options' | 'questions' | 'change' | 'disagree';
export interface CodeReviewMessage {
    id: string;
    item_id: string;
    author: 'developer' | 'agent';
    kind: CodeReviewMessageKind;
    text: string;
    /** Choices offered by the agent; `recommended` marks its pick. */
    options: {
        label: string;
        recommended?: boolean;
    }[];
    /** Index of the option the developer chose («Сделать так»). */
    choice: number | null;
    /** Files the agent reports it changed for this item. */
    files: string[];
    round_id: string | null;
    sent: boolean;
    created_at: string;
}
export interface CodeReviewFileView {
    review_id: string;
    path: string;
    content_hash: string;
    invalidated: boolean;
    viewed_at: string;
}
export type CreateCodeReview = Pick<CodeReview, 'project_id' | 'branch' | 'head_start' | 'origin' | 'origin_id'> & Partial<Pick<CodeReview, 'head_commit'>>;
export type UpdateCodeReview = Partial<Pick<CodeReview, 'status' | 'head_end'>>;
export type CreateCodeReviewRound = Pick<CodeReviewRound, 'review_id' | 'snapshot_tree'> & Partial<Pick<CodeReviewRound, 'session_id'>>;
export type UpdateCodeReviewItem = Partial<Omit<CodeReviewItem, 'id' | 'review_id' | 'created_at' | 'updated_at'>>;
export type CreateCodeReviewItem = Pick<CodeReviewItem, 'review_id' | 'scope' | 'kind' | 'text'> & UpdateCodeReviewItem;
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type CodeReviewsGETExternalResponse = {
    "mr": null | {
        "iid": number;
        "title": string;
        "url": string;
        "state": string;
    };
    "threads": ({
        "id": string;
        "resolved": boolean;
        "path": null | string;
        "line": null | number;
        "side": "new" | "old";
        "notes": ({
            "id": number;
            "author": string;
            "body": string;
            "mine": boolean;
        })[];
    })[];
};
export type CodeReviewsPOSTExternalDiscussionIdReplyBody = {
    body: string;
    confirmed: boolean;
};
export type CodeReviewsPUTExternalDiscussionIdResolvedBody = {
    resolved: boolean;
};
export type CodeReviewsPUTExternalDiscussionIdNotesNoteIdBody = {
    body: string;
};
export type CodeReviewsGETAttentionResponse = ({
    "project_id": string;
    "review_id": string;
    "origin": C.CodeReviewOrigin;
    "origin_id": string;
    "count": number;
    "items": (C.CodeReviewItem)[];
})[];
export type CodeReviewsPOSTReviewIdRoundsResponse = {
    "round": C.CodeReviewRound;
    "items": (C.CodeReviewItem)[];
};
export type CodeReviewsPOSTReviewIdRoundsBody = {
    session_id: string;
    note?: string;
    item_ids?: string[];
};
export type CodeReviewsPOSTReviewIdStopResponse = {
    "stopped": number;
};
export type CodeReviewsPOSTReviewIdItemsItemIdMessagesBody = {
    kind?: C.CodeReviewMessageKind;
    text: string;
    choice?: number | null;
};
export type CodeReviewsPOSTReviewIdItemsItemIdCloseBody = {
    resolution: 'accept' | 'answered' | 'reject' | 'reopen';
};
export type CodeReviewsPUTCurrentViewedResponse = {
    "review": C.CodeReview;
    "view": C.CodeReviewFileView;
} | {
    "review": null | C.CodeReview;
    "view": null;
};
export type CodeReviewsPUTCurrentViewedBody = {
    path: string;
    viewed: boolean;
    origin?: C.CodeReviewOrigin;
    origin_id?: string;
};
export type CodeReviewsGETCurrentComparisonResponse = {
    "changes": (C.GitChange)[];
    "stats": {
        [key: string]: C.LineStat;
    };
    "base": string;
    "end": string;
};
export type CodeReviewsGETCurrentResponse = {
    "repository": null | C.RepositoryInfo;
    "review": null | C.CodeReview;
    "items": (C.CodeReviewItem)[];
    "messages": (C.CodeReviewMessage)[];
    "rounds": (C.CodeReviewRound)[];
    "summary": null | {
        "head_start": string;
        "head_current": null | string;
        "commits": null | number;
        "rounds": number;
        "items": number;
        "unresolved": number;
    };
    "file_views": ({
        "invalidated": boolean;
        "current_hash": string;
        "viewed": boolean;
        "changed_after_view": boolean;
        "review_id": string;
        "path": string;
        "content_hash": string;
        "viewed_at": string;
    })[];
    "other_reviews": (C.CodeReview)[];
    "running_other_reviews": (C.CodeReview)[];
    "agent_working": boolean;
    "attention": number;
    "head_changed": boolean;
};
export type CodeReviewsGETResponse = ({
    "read_only": boolean;
    "commits": null | number;
    "rounds": number;
    "items": number;
    "resolved": number;
    "unresolved": number;
    "id": string;
    "number": number;
    "project_id": string;
    "branch": null | string;
    "head_commit": null | string;
    "status": C.CodeReviewStatus;
    "origin": C.CodeReviewOrigin;
    "origin_id": string;
    "head_start": string;
    "head_last": string;
    "head_end": null | string;
    "created_at": string;
    "closed_at": null | string;
})[];
export type CodeReviewsPOSTItemsResponse = {
    "review": C.CodeReview;
    "item": C.CodeReviewItem;
};
export type CodeReviewsPOSTItemsBody = C.ReviewDraft & {
    origin?: C.CodeReviewOrigin;
    origin_id?: string;
};
export type CodeReviewsGETReviewIdResponse = {
    "review": C.CodeReview;
    "read_only": boolean;
    "items": (C.CodeReviewItem)[];
    "messages": (C.CodeReviewMessage)[];
    "rounds": (C.CodeReviewRound)[];
    "chats": ({
        "session_id": null | string;
        "events": ({
            "payload": JsonValue;
            "seq": number;
            "type": string;
            "created_at": string;
        })[];
    })[];
    "file_views": (C.CodeReviewFileView)[];
};
export type CodeReviewsGETReviewIdDiffResponse = {
    "diff": string;
};
export type CodeReviewsPATCHReviewIdItemsItemIdBody = C.DraftPatch;
export type CodeReviewsPUTReviewIdViewedBody = {
    "path"?: string;
    "viewed"?: boolean;
};
export type CodeReviewsPOSTReviewIdFinishResponse = {
    "review": C.CodeReview;
    "next_review": null | C.CodeReview;
};
export type CodeReviewsPOSTReviewIdFinishBody = {
    "mode"?: undefined | "close" | "require_resolved" | "carry";
};
export interface CodeReviewsEndpoints {
    "POST /api/projects/:projectId/code-reviews/agent/preview": Endpoint<"POST /api/projects/:projectId/code-reviews/agent/preview", CodeReviewLaunch, CodeReviewPreview, { workspace?: string }, "json", never>;
    "POST /api/projects/:projectId/code-reviews/agent/start": Endpoint<"POST /api/projects/:projectId/code-reviews/agent/start", CodeReviewLaunch, C.AgentSession, { workspace?: string }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/external": Endpoint<"GET /api/projects/:projectId/code-reviews/external", never, CodeReviewsGETExternalResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/code-reviews/external/:discussionId/reply": Endpoint<"POST /api/projects/:projectId/code-reviews/external/:discussionId/reply", CodeReviewsPOSTExternalDiscussionIdReplyBody, CodeReviewsGETExternalResponse, {
        "workspace"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/code-reviews/external/:discussionId/resolved": Endpoint<"PUT /api/projects/:projectId/code-reviews/external/:discussionId/resolved", CodeReviewsPUTExternalDiscussionIdResolvedBody, CodeReviewsGETExternalResponse, {
        "workspace"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId": Endpoint<"PUT /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId", CodeReviewsPUTExternalDiscussionIdNotesNoteIdBody, CodeReviewsGETExternalResponse, {
        "workspace"?: string;
    }, "json", never>;
    "DELETE /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId": Endpoint<"DELETE /api/projects/:projectId/code-reviews/external/:discussionId/notes/:noteId", never, CodeReviewsGETExternalResponse, {
        "confirmed"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/attention": Endpoint<"GET /api/projects/:projectId/code-reviews/attention", never, CodeReviewsGETAttentionResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/code-reviews/:reviewId/rounds": Endpoint<"POST /api/projects/:projectId/code-reviews/:reviewId/rounds", CodeReviewsPOSTReviewIdRoundsBody, CodeReviewsPOSTReviewIdRoundsResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/code-reviews/:reviewId/stop": Endpoint<"POST /api/projects/:projectId/code-reviews/:reviewId/stop", never, CodeReviewsPOSTReviewIdStopResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages": Endpoint<"POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages", CodeReviewsPOSTReviewIdItemsItemIdMessagesBody, C.CodeReviewMessage, {
        "workspace"?: string;
    }, "json", never>;
    "DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages/:messageId": Endpoint<"DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/messages/:messageId", never, void, {
        "workspace"?: string;
    }, "empty", never>;
    "POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/close": Endpoint<"POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/close", CodeReviewsPOSTReviewIdItemsItemIdCloseBody, C.CodeReviewItem, {
        "workspace"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/code-reviews/current/viewed": Endpoint<"PUT /api/projects/:projectId/code-reviews/current/viewed", CodeReviewsPUTCurrentViewedBody, CodeReviewsPUTCurrentViewedResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/current/comparison": Endpoint<"GET /api/projects/:projectId/code-reviews/current/comparison", never, CodeReviewsGETCurrentComparisonResponse, {
        "ref"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/current": Endpoint<"GET /api/projects/:projectId/code-reviews/current", never, CodeReviewsGETCurrentResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews": Endpoint<"GET /api/projects/:projectId/code-reviews", never, CodeReviewsGETResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/code-reviews/items": Endpoint<"POST /api/projects/:projectId/code-reviews/items", CodeReviewsPOSTItemsBody, CodeReviewsPOSTItemsResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/:reviewId": Endpoint<"GET /api/projects/:projectId/code-reviews/:reviewId", never, CodeReviewsGETReviewIdResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/:reviewId/file-items": Endpoint<"GET /api/projects/:projectId/code-reviews/:reviewId/file-items", never, (C.CodeReviewItem)[], {
        "path"?: string;
        "side"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/:reviewId/diff": Endpoint<"GET /api/projects/:projectId/code-reviews/:reviewId/diff", never, CodeReviewsGETReviewIdDiffResponse, {
        "path"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code-reviews/:reviewId/changes": Endpoint<"GET /api/projects/:projectId/code-reviews/:reviewId/changes", never, CodeReviewsGETCurrentComparisonResponse, {
        "base"?: string;
        "round"?: string;
        "workspace"?: string;
    }, "json", never>;
    "PATCH /api/projects/:projectId/code-reviews/:reviewId/items/:itemId": Endpoint<"PATCH /api/projects/:projectId/code-reviews/:reviewId/items/:itemId", CodeReviewsPATCHReviewIdItemsItemIdBody, null | C.CodeReviewItem, {
        "workspace"?: string;
    }, "json", never>;
    "DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId": Endpoint<"DELETE /api/projects/:projectId/code-reviews/:reviewId/items/:itemId", never, void, {
        "workspace"?: string;
    }, "empty", never>;
    "POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/general": Endpoint<"POST /api/projects/:projectId/code-reviews/:reviewId/items/:itemId/general", never, null | C.CodeReviewItem, {
        "workspace"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/code-reviews/:reviewId/viewed": Endpoint<"PUT /api/projects/:projectId/code-reviews/:reviewId/viewed", CodeReviewsPUTReviewIdViewedBody, null | C.CodeReviewFileView, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/code-reviews/:reviewId/finish": Endpoint<"POST /api/projects/:projectId/code-reviews/:reviewId/finish", CodeReviewsPOSTReviewIdFinishBody, CodeReviewsPOSTReviewIdFinishResponse, {
        "workspace"?: string;
    }, "json", never>;
    "DELETE /api/projects/:projectId/code-reviews/:reviewId": Endpoint<"DELETE /api/projects/:projectId/code-reviews/:reviewId", never, void, {
        "workspace"?: string;
    }, "empty", never>;
}
