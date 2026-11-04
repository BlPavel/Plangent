import type { CodeReview, CodeReviewRound, CodeReviewItem, CodeReviewMessage, CodeReviewFileView, CreateCodeReviewItem } from './index';
export interface RepositoryInfo {
    branch: string | null;
    head: string | null;
    message: string | null;
    detached: boolean;
}
export interface GitChange {
    path: string;
    originalPath?: string;
    status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';
    indexStatus: string;
    worktreeStatus: string;
}
export interface TreeEntry {
    name: string;
    path: string;
    directory: boolean;
    ignored: boolean;
    status?: GitChange['status'];
    changes: number;
}
export interface LineStat {
    added: number;
    deleted: number;
    binary?: boolean;
}
export interface CodeFile {
    path: string;
    size: number;
    kind: 'text' | 'image' | 'binary' | 'too-large';
    content?: string;
    mime?: string;
}
export interface DiffOptions {
    base?: string;
    end?: string;
    originalPath?: string;
    ignoreWhitespace?: boolean;
}
export interface SearchOptions {
    query: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    mask?: string;
}
export type SearchStreamEvent = SearchEvent | { type: 'error'; error: string };
export type SearchEvent = {
    type: 'match';
    path: string;
    line: number;
    text: string;
} | {
    type: 'done';
    matches: number;
    files: number;
    truncated: boolean;
};
export type ReviewDraft = {
    comparison_ref?: string;
} & Omit<CreateCodeReviewItem, 'review_id' | 'round_id' | 'author' | 'status' | 'answer' | 'carried_from_item_id' | 'outdated' | 'closed'>;
export type DraftPatch = Partial<Pick<CodeReviewItem, 'scope' | 'file' | 'line_start' | 'line_end' | 'side' | 'kind' | 'text' | 'refs' | 'code_snippet'>>;
export interface ReviewAttention {
    project_id: string;
    review_id: string;
    origin: 'project' | 'task';
    origin_id: string;
    count: number;
    items: CodeReviewItem[];
}
export interface ReviewDetail {
    review: CodeReview;
    read_only: boolean;
    items: CodeReviewItem[];
    messages: CodeReviewMessage[];
    rounds: CodeReviewRound[];
    file_views: CodeReviewFileView[];
    chats: {
        session_id: string | null;
        events: {
            seq: number;
            type: string;
            payload: unknown;
            created_at: string;
        }[];
    }[];
}
export interface CurrentReview {
    repository: RepositoryInfo | null;
    review: CodeReview | null;
    items: CodeReviewItem[];
    messages: CodeReviewMessage[];
    rounds: CodeReviewRound[];
    summary: {
        head_start: string;
        head_current: string | null;
        commits: number | null;
        rounds: number;
        items: number;
        unresolved: number;
    } | null;
    file_views: (CodeReviewFileView & {
        current_hash: string | null;
        viewed: boolean;
        changed_after_view: boolean;
    })[];
    other_reviews: CodeReview[];
    running_other_reviews: CodeReview[];
    agent_working: boolean;
    attention: number;
    head_changed: boolean;
}
export interface BaseChanges {
    base: string;
    end: string;
    changes: GitChange[];
    stats: Record<string, LineStat>;
}
export type ReviewHistory = CodeReview & {
    read_only: boolean;
    commits: number | null;
    rounds: number;
    items: number;
    resolved: number;
    unresolved: number;
};
export interface ExternalNote {
    id: number;
    author: string;
    body: string;
    mine: boolean;
}
export interface ExternalThread {
    id: string;
    resolved: boolean;
    path: string | null;
    line: number | null;
    side: 'new' | 'old';
    notes: ExternalNote[];
}
export interface ExternalThreads {
    mr: {
        iid: number;
        title: string;
        url: string;
        state: string;
    } | null;
    threads: ExternalThread[];
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type CodeGETStatsResponse = {
    [key: string]: C.LineStat;
};
export type CodeGETOldFileResponse = {
    "content": string;
};
export type CodeGETDiffResponse = {
    "diff": string;
};
export interface CodeEndpoints {
    "GET /api/projects/:projectId/code/repository": Endpoint<"GET /api/projects/:projectId/code/repository", never, null | C.RepositoryInfo, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/changes": Endpoint<"GET /api/projects/:projectId/code/changes", never, (C.GitChange)[], {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/stats": Endpoint<"GET /api/projects/:projectId/code/stats", never, CodeGETStatsResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/files": Endpoint<"GET /api/projects/:projectId/code/files", never, (string)[], {
        "includeIgnored"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/tree": Endpoint<"GET /api/projects/:projectId/code/tree", never, (C.TreeEntry)[], {
        "includeIgnored"?: string;
        "path"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/file": Endpoint<"GET /api/projects/:projectId/code/file", never, C.CodeFile, {
        "path"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/image": Endpoint<"GET /api/projects/:projectId/code/image", never, void, {
        "path"?: string;
        "workspace"?: string;
    }, "file", never>;
    "GET /api/projects/:projectId/code/old-file": Endpoint<"GET /api/projects/:projectId/code/old-file", never, CodeGETOldFileResponse, {
        "base"?: string;
        "path"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/diff": Endpoint<"GET /api/projects/:projectId/code/diff", never, CodeGETDiffResponse, {
        "base"?: string;
        "end"?: string;
        "ignoreWhitespace"?: string;
        "originalPath"?: string;
        "path"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/code/search": Endpoint<"GET /api/projects/:projectId/code/search", never, void, {
        "caseSensitive"?: string;
        "mask"?: string;
        "q"?: string;
        "regex"?: string;
        "wholeWord"?: string;
        "workspace"?: string;
    }, "ndjson", C.SearchStreamEvent>;
}
