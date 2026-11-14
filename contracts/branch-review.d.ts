import type { ExternalThread } from './index';
export interface ReviewFile {
    path: string;
    old_path?: string;
    status: string;
    added: number;
    deleted: number;
    binary: boolean;
    sig: string;
    /** Changed by the author after the developer's last publication. */
    changed_since: boolean;
}
export interface ReviewCommit {
    sha: string;
    subject: string;
    author: string;
    date: string;
}
export interface BranchReview {
    review: {
        id: string;
        project_id: string;
        branch: string;
        base: string;
        branch_name: string;
        base_name: string;
        head: string;
        merge_base: string;
        mr_iid: number | null;
        context: string;
        task_id: string | null;
        skill_id: string | null;
        overview: string;
        overview_head: string;
        published_head: string;
        /** The agent's review: '' before it, running, done, stopped or failed. */
        analysis_status: '' | 'running' | 'done' | 'stopped' | 'failed';
        analysis_session: string;
        analysis_note: string;
    };
    files: ReviewFile[];
    commits: ReviewCommit[];
    commit_count: number;
    new_commits: number;
    rewritten: boolean;
    /** Commits after the last publication. */
    round_commits: number;
}
export interface ReviewThread {
    id: string;
    review_id: string;
    head: string;
    path: string;
    side: string;
    line: number;
    session_id: string;
}
export interface BranchQuestion {
    id: string;
    review_id: string;
    path: string;
    side: 'old' | 'new';
    line: number;
    /** The remark this discussion is about; empty for a question of its own. */
    remark_id: string;
    /** The colleague's GitLab thread this discussion is about; empty otherwise. */
    thread_id: string;
    closed: boolean;
    created_at: string;
}
export interface BranchQuestionMessage {
    id: string;
    question_id: string;
    author: 'developer' | 'agent';
    kind: string;
    text: string;
    sent: boolean;
    created_at: string;
}
export interface BranchQuestions {
    questions: BranchQuestion[];
    messages: BranchQuestionMessage[];
}
export interface Approvals {
    count: number;
    required: number | null;
    left: number | null;
    mine: boolean;
    names: string[];
}
export interface MrListItem {
    project_id: string;
    project_name: string;
    iid: number;
    title: string;
    web_url: string;
    author: {
        name: string;
        username: string;
    };
    source_branch: string;
    target_branch: string;
    created_at: string;
    updated_at: string;
    notes: number;
    /** I wrote it. */
    mine: boolean;
    reviewer: boolean;
    approvals: Approvals | null;
    /** Unresolved threads and those of them I started; null when not loaded (MRs I have nothing to do with). */
    threads: {
        open: number;
        mine_open: number;
    } | null;
    /** The author pushed after I published my remarks. */
    after_review: boolean;
    review_id: string | null;
}
export interface MrList {
    items: MrListItem[];
    errors: {
        project_id: string;
        project_name: string;
        message: string;
    }[];
}
export interface MrInfo {
    mr: {
        iid: number;
        title: string;
        description: string;
        web_url: string;
        state: string;
        author: {
            name: string;
            username: string;
        };
        source_branch: string;
        target_branch: string;
        head_sha: string;
    };
    approvals: Approvals | null;
    threads: ExternalThread[];
}
export interface BranchReviewRemark {
    id: string;
    review_id: string;
    path: string;
    side: 'old' | 'new';
    line: number;
    head: string;
    body: string;
    author: 'developer' | 'agent';
    remote_id: number | null;
    status: 'draft' | 'sent' | 'uncertain' | 'rejected';
    /** The text from before a discussion or an edit changed it; null if it never changed. */
    original: string | null;
    error: string;
    created_at: string;
    /** The developer has changed the text (of an agent's draft too). */
    edited: boolean;
    /** Attached to a line of an older version of the branch. */
    outdated: boolean;
}
export interface BranchReviewRemarks {
    remarks: BranchReviewRemark[];
    publication_error?: string;
}
export interface ReviewSkill {
    id: string;
    title: string;
    description: string;
    origin: 'direct' | 'group' | 'global';
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type BranchReviewPOSTOpenResponse = {
    "review": {
        "id": string;
        "project_id": string;
        "branch": string;
        "base": string;
        "branch_name": string;
        "base_name": string;
        "head": string;
        "merge_base": string;
        "mr_iid": null | number;
        "context": string;
        "task_id": null | string;
        "skill_id": null | string;
        "overview": string;
        "overview_head": string;
        "published_head": string;
        "analysis_status": BranchReview['review']['analysis_status'];
        "analysis_session": string;
        "analysis_note": string;
    };
    "files": ({
        "changed_since": boolean;
        "path": string;
        "old_path"?: string;
        "status": string;
        "added": number;
        "deleted": number;
        "binary": boolean;
        "sig": string;
    })[];
    "commits": ({
        "sha": string;
        "subject": string;
        "author": string;
        "date": string;
    })[];
    "commit_count": number;
    "new_commits": number;
    "rewritten": boolean;
    "round_commits": number;
};
export type BranchReviewGETMergeRequestsResponse = {
    "items": ({
        "project_id": string;
        "project_name": string;
        "iid": number;
        "title": string;
        "web_url": string;
        "author": {
            "name": string;
            "username": string;
        };
        "source_branch": string;
        "target_branch": string;
        "created_at": string;
        "updated_at": string;
        "notes": number;
        "mine": boolean;
        "reviewer": boolean;
        "approvals": null | {
            "count": number;
            "required": null | number;
            "left": null | number;
            "mine": boolean;
            "names": (string)[];
        };
        "threads": null | {
            "open": number;
            "mine_open": number;
        };
        "after_review": boolean;
        "review_id": null | string;
    })[];
    "errors": ({
        "project_id": string;
        "project_name": string;
        "message": string;
    })[];
};
export type BranchReviewPOSTMergeRequestsOpenBody = {
    iid: number;
};
export type BranchReviewGETSkillsResponse = ({
    "id": string;
    "title": string;
    "description": string;
    "origin": "group" | "global" | "direct";
})[];
export type BranchReviewPUTIdContextBody = {
    context?: string;
    task_id?: string | null;
    skill_id?: string | null;
};
export type BranchReviewGETIdDiffResponse = {
    "diff": string;
};
export type BranchReviewGETIdFileResponse = {
    "content": string;
};
export type BranchReviewGETIdThreadsResponse = ({
    "id": string;
    "review_id": string;
    "head": string;
    "path": string;
    "side": string;
    "line": number;
    "session_id": string;
})[];
export type BranchReviewPOSTIdThreadsResponse = {
    "id": string;
    "review_id": string;
    "head": string;
    "path": string;
    "side": string;
    "line": number;
    "session_id": string;
};
export type BranchReviewPOSTIdThreadsBody = {
    path?: string;
    side?: 'old' | 'new';
    line?: number;
};
export type BranchReviewPOSTIdFinishResponse = {
    "finished": boolean;
};
export type BranchReviewGETIdMrResponse = {
    "mr": {
        "iid": number;
        "title": string;
        "description": string;
        "web_url": string;
        "state": string;
        "author": {
            "name": string;
            "username": string;
        };
        "source_branch": string;
        "target_branch": string;
        "head_sha": string;
    };
    "approvals": null | {
        "count": number;
        "required": null | number;
        "left": null | number;
        "mine": boolean;
        "names": (string)[];
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
export type BranchReviewPOSTIdMrApproveBody = {
    approved: boolean;
};
export type BranchReviewPOSTIdMrThreadsDidReplyBody = {
    body: string;
    confirmed?: boolean;
};
export type BranchReviewPUTIdMrThreadsDidResolvedBody = {
    resolved: boolean;
};
export type BranchReviewPUTIdMrThreadsDidNotesNidBody = {
    body: string;
};
export type BranchReviewGETIdRemarksResponse = {
    "remarks": ({
        "edited": boolean;
        "outdated": boolean;
        "id": string;
        "review_id": string;
        "path": string;
        "side": "new" | "old";
        "line": number;
        "head": string;
        "body": string;
        "author": "developer" | "agent";
        "remote_id": null | number;
        "status": "draft" | "sent" | "uncertain" | "rejected";
        "original": null | string;
        "error": string;
        "created_at": string;
    })[];
};
export type BranchReviewPOSTIdRemarksBody = {
    body: string;
    path?: string | null;
    side?: 'old' | 'new';
    line?: number;
};
export type BranchReviewPOSTIdRemarksRidRejectBody = {
    rejected: boolean;
};
export type BranchReviewPOSTIdRemarksPublishResponse = {
    "remarks": ({
        "edited": boolean;
        "outdated": boolean;
        "id": string;
        "review_id": string;
        "path": string;
        "side": "new" | "old";
        "line": number;
        "head": string;
        "body": string;
        "author": "developer" | "agent";
        "remote_id": null | number;
        "status": "draft" | "sent" | "uncertain" | "rejected";
        "original": null | string;
        "error": string;
        "created_at": string;
    })[];
} | {
    "publication_error": string;
    "remarks": ({
        "edited": boolean;
        "outdated": boolean;
        "id": string;
        "review_id": string;
        "path": string;
        "side": "new" | "old";
        "line": number;
        "head": string;
        "body": string;
        "author": "developer" | "agent";
        "remote_id": null | number;
        "status": "draft" | "sent" | "uncertain" | "rejected";
        "original": null | string;
        "error": string;
        "created_at": string;
    })[];
};
export type BranchReviewPOSTIdRemarksPublishBody = {
    ids: string[];
    confirmed: boolean;
};
export type BranchReviewPOSTIdRemarksMarkSentBody = {
    ids: string[];
};
export type BranchReviewPUTIdRemarksRidBody = {
    body?: string;
};
export type BranchReviewPOSTIdRemarksRidRecoverBody = {
    published: boolean;
};
export type BranchReviewPOSTIdAnalyzeResponse = {
    "thread": {
        "id": string;
        "review_id": string;
        "head": string;
        "path": string;
        "side": string;
        "line": number;
        "session_id": string;
    };
};
export type BranchReviewPOSTIdAnalyzeBody = {
    note?: string;
    /** Agent for this review; without it the review agent of the project settings. */
    agent_id?: string;
    model?: string;
    reasoning_effort?: string;
};
export type BranchReviewPOSTIdCheckFixesResponse = {
    "thread": {
        "id": string;
        "review_id": string;
        "head": string;
        "path": string;
        "side": string;
        "line": number;
        "session_id": string;
    };
    "questions": ({
        "id": string;
        "review_id": string;
        "path": string;
        "side": "new" | "old";
        "line": number;
        "remark_id": string;
        "thread_id": string;
        "closed": boolean;
        "created_at": string;
    })[];
    "messages": ({
        "id": string;
        "question_id": string;
        "author": "developer" | "agent";
        "kind": string;
        "text": string;
        "sent": boolean;
        "created_at": string;
    })[];
};
export type BranchReviewGETIdQuestionsResponse = {
    "questions": ({
        "id": string;
        "review_id": string;
        "path": string;
        "side": "new" | "old";
        "line": number;
        "remark_id": string;
        "thread_id": string;
        "closed": boolean;
        "created_at": string;
    })[];
    "messages": ({
        "id": string;
        "question_id": string;
        "author": "developer" | "agent";
        "kind": string;
        "text": string;
        "sent": boolean;
        "created_at": string;
    })[];
};
export type BranchReviewPOSTIdQuestionsBody = {
    text: string;
    path?: string;
    side?: 'old' | 'new';
    line?: number;
    remark_id?: string;
    thread_id?: string;
};
export type BranchReviewPOSTIdQuestionsSendBody = {
    question_ids?: string[];
};
export type BranchReviewPOSTIdQuestionsQidMessagesBody = {
    text: string;
};
export type BranchReviewPUTIdQuestionsQidMessagesMidBody = {
    text: string;
};
export type BranchReviewPOSTIdQuestionsQidCloseBody = {
    closed?: boolean;
};
export interface BranchReviewEndpoints {
    "GET /api/projects/:projectId/branch-review/merge-requests": Endpoint<"GET /api/projects/:projectId/branch-review/merge-requests", never, BranchReviewGETMergeRequestsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/merge-requests/open": Endpoint<"POST /api/projects/:projectId/branch-review/merge-requests/open", BranchReviewPOSTMergeRequestsOpenBody, BranchReviewPOSTOpenResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/branch-review/skills": Endpoint<"GET /api/projects/:projectId/branch-review/skills", never, BranchReviewGETSkillsResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/branch-review/:id": Endpoint<"GET /api/projects/:projectId/branch-review/:id", never, BranchReviewPOSTOpenResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/refresh": Endpoint<"POST /api/projects/:projectId/branch-review/:id/refresh", never, BranchReviewPOSTOpenResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/acknowledge": Endpoint<"POST /api/projects/:projectId/branch-review/:id/acknowledge", never, BranchReviewPOSTOpenResponse, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/branch-review/:id/context": Endpoint<"PUT /api/projects/:projectId/branch-review/:id/context", BranchReviewPUTIdContextBody, BranchReviewPOSTOpenResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/branch-review/:id/diff": Endpoint<"GET /api/projects/:projectId/branch-review/:id/diff", never, BranchReviewGETIdDiffResponse, {
        "path"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/branch-review/:id/file": Endpoint<"GET /api/projects/:projectId/branch-review/:id/file", never, BranchReviewGETIdFileResponse, {
        "path"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/branch-review/:id/threads": Endpoint<"GET /api/projects/:projectId/branch-review/:id/threads", never, BranchReviewGETIdThreadsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/threads": Endpoint<"POST /api/projects/:projectId/branch-review/:id/threads", BranchReviewPOSTIdThreadsBody, BranchReviewPOSTIdThreadsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/finish": Endpoint<"POST /api/projects/:projectId/branch-review/:id/finish", never, BranchReviewPOSTIdFinishResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/branch-review/:id/mr": Endpoint<"GET /api/projects/:projectId/branch-review/:id/mr", never, BranchReviewGETIdMrResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/mr/approve": Endpoint<"POST /api/projects/:projectId/branch-review/:id/mr/approve", BranchReviewPOSTIdMrApproveBody, BranchReviewGETIdMrResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/mr/threads/:did/reply": Endpoint<"POST /api/projects/:projectId/branch-review/:id/mr/threads/:did/reply", BranchReviewPOSTIdMrThreadsDidReplyBody, BranchReviewGETIdMrResponse, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/resolved": Endpoint<"PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/resolved", BranchReviewPUTIdMrThreadsDidResolvedBody, BranchReviewGETIdMrResponse, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid": Endpoint<"PUT /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid", BranchReviewPUTIdMrThreadsDidNotesNidBody, BranchReviewGETIdMrResponse, Record<string, never>, "json", never>;
    "DELETE /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid": Endpoint<"DELETE /api/projects/:projectId/branch-review/:id/mr/threads/:did/notes/:nid", never, BranchReviewGETIdMrResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/branch-review/:id/remarks": Endpoint<"GET /api/projects/:projectId/branch-review/:id/remarks", never, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/remarks": Endpoint<"POST /api/projects/:projectId/branch-review/:id/remarks", BranchReviewPOSTIdRemarksBody, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/remarks/publish": Endpoint<"POST /api/projects/:projectId/branch-review/:id/remarks/publish", BranchReviewPOSTIdRemarksPublishBody, BranchReviewPOSTIdRemarksPublishResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/remarks/mark-sent": Endpoint<"POST /api/projects/:projectId/branch-review/:id/remarks/mark-sent", BranchReviewPOSTIdRemarksMarkSentBody, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/branch-review/:id/remarks/:rid": Endpoint<"PUT /api/projects/:projectId/branch-review/:id/remarks/:rid", BranchReviewPUTIdRemarksRidBody, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "DELETE /api/projects/:projectId/branch-review/:id/remarks/:rid": Endpoint<"DELETE /api/projects/:projectId/branch-review/:id/remarks/:rid", never, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/remarks/:rid/reject": Endpoint<"POST /api/projects/:projectId/branch-review/:id/remarks/:rid/reject", BranchReviewPOSTIdRemarksRidRejectBody, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/remarks/:rid/detach": Endpoint<"POST /api/projects/:projectId/branch-review/:id/remarks/:rid/detach", never, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/remarks/:rid/recover": Endpoint<"POST /api/projects/:projectId/branch-review/:id/remarks/:rid/recover", BranchReviewPOSTIdRemarksRidRecoverBody, BranchReviewGETIdRemarksResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/analyze": Endpoint<"POST /api/projects/:projectId/branch-review/:id/analyze", BranchReviewPOSTIdAnalyzeBody, BranchReviewPOSTIdAnalyzeResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/restart": Endpoint<"POST /api/projects/:projectId/branch-review/:id/restart", never, BranchReviewPOSTOpenResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/check-fixes": Endpoint<"POST /api/projects/:projectId/branch-review/:id/check-fixes", never, BranchReviewPOSTIdCheckFixesResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/branch-review/:id/questions": Endpoint<"GET /api/projects/:projectId/branch-review/:id/questions", never, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/questions": Endpoint<"POST /api/projects/:projectId/branch-review/:id/questions", BranchReviewPOSTIdQuestionsBody, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/questions/send": Endpoint<"POST /api/projects/:projectId/branch-review/:id/questions/send", BranchReviewPOSTIdQuestionsSendBody, BranchReviewPOSTIdCheckFixesResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/questions/:qid/messages": Endpoint<"POST /api/projects/:projectId/branch-review/:id/questions/:qid/messages", BranchReviewPOSTIdQuestionsQidMessagesBody, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid": Endpoint<"PUT /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid", BranchReviewPUTIdQuestionsQidMessagesMidBody, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
    "DELETE /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid": Endpoint<"DELETE /api/projects/:projectId/branch-review/:id/questions/:qid/messages/:mid", never, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
    "DELETE /api/projects/:projectId/branch-review/:id/questions/:qid": Endpoint<"DELETE /api/projects/:projectId/branch-review/:id/questions/:qid", never, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/questions/:qid/close": Endpoint<"POST /api/projects/:projectId/branch-review/:id/questions/:qid/close", BranchReviewPOSTIdQuestionsQidCloseBody, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/branch-review/:id/questions/stop": Endpoint<"POST /api/projects/:projectId/branch-review/:id/questions/stop", never, BranchReviewGETIdQuestionsResponse, Record<string, never>, "json", never>;
}
