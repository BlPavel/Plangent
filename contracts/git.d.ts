import type { RepositoryInfo } from './index';
export interface GitOperationState {
    kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'conflict';
    id: string;
    branch: string | null;
    commit: {
        sha: string;
        subject: string;
        name: string | null;
    } | null;
    onto: {
        sha: string;
        name: string | null;
    } | null;
    step: {
        done: number;
        total: number;
    } | null;
}
export interface GitTracking extends RepositoryInfo {
    upstream: string | null;
    ahead: number;
    behind: number;
    origin: string | null;
    busyReason: string;
    operation: GitOperationState | null;
}
export interface ConflictFile {
    path: string;
    code: string;
    conflicted: boolean;
    note: {
        outcome: 'resolved' | 'question' | 'recommend';
        text: string;
        answer: string;
        answer_sent: boolean;
    } | null;
}
export interface ConflictState {
    operation: GitOperationState | null;
    files: ConflictFile[];
    session: {
        id: string;
        status: string;
        reason: string;
    } | null;
}
export interface GitBranch {
    name: string;
    ref: string;
    remote: boolean;
}
export interface Coauthor {
    name: string;
    email: string;
}
export interface CommitMessageInput {
    title: string;
    body?: string;
    includeDescription?: boolean;
    includeCoauthors?: boolean;
    coauthors?: Coauthor[];
}
export type CommitInput = Required<CommitMessageInput>;
export interface CommitViolation { kind: 'forbidden' | 'format'; severity: 'error' | 'warning'; line: number; text: string; pattern: string }
export interface MessageCheck {
    cleanedCoauthors?: Coauthor[];
    message: string;
    cleaned: string;
    violations: {
        kind: 'forbidden' | 'format';
        line: number;
        text: string;
        pattern: string;
    }[];
}
export type GitPreferences = Required<Pick<import('./projects').ProjectGitSettings, 'include_description' | 'branch_prefixes' | 'base_branch' | 'finish_scenario' | 'mr_reviewers' | 'mr_assignees' | 'mr_squash' | 'mr_remove_branch' | 'git_agent_id' | 'git_agent_model' | 'git_agent_effort'>> & Pick<import('./projects').ProjectGitSettings, 'auto_review'> & {
    agent: {
        agentId: string;
        model: string;
        effort: string;
    } | null;
};
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type GitGETRepositoryResponse = null | {
    "busyReason": string;
    "operation": null | C.GitOperationState;
    "upstream": null | string;
    "ahead": number;
    "behind": number;
    "origin": null | string;
    "detachedBranches": (string)[];
    "branch": null | string;
    "head": null | string;
    "message": null | string;
    "detached": boolean;
};
export type GitGETSettingsResponse = {
    "agent": null | {
        "agentId": string;
        "model": string;
        "effort": string;
    };
    "commit_pattern": string;
    "workspace_copy_files": (string)[];
    "workspace_setup_command": string;
    "auto_review": boolean;
    "forbidden_patterns": (string)[];
    "include_description": boolean;
    "finish_scenario": "push" | "nothing" | "commits" | "full";
    "branch_prefixes": (string)[];
    "base_branch": string;
    "mr_description_prompt": string;
    "mr_remove_branch": boolean;
    "mr_squash": boolean;
    "mr_reviewers": (string)[];
    "mr_assignees": (string)[];
    "git_agent_id": string;
    "git_agent_model": string;
    "git_agent_effort": string;
    "review_agent_id": string;
    "review_agent_model": string;
    "review_agent_effort": string;
    "review_agent_policy": string;
    "conflict_agent_id": string;
    "conflict_agent_model": string;
    "conflict_agent_effort": string;
};
export type GitGETCoauthorsResponse = ({
    "name": string;
    "email": string;
})[];
export type GitPOSTCancelBody = {
    "operationId"?: string;
};
export type GitPOSTStageResponse = {
    operationId: string;
    output: JsonValue;
};
export type GitPOSTStageBody = {
    paths: string[];
    operationId?: string;
};
export type GitPOSTUnstageBody = {
    paths: string[];
    operationId?: string;
};
export type GitPOSTDiscardBody = {
    paths: string[];
    operationId?: string;
};
export type GitPOSTFetchBody = {
    operationId?: string;
};
export type GitPOSTPullBody = {
    operationId?: string;
};
export type GitPOSTPushBody = {
    operationId?: string;
};
export type GitPOSTPullRebaseBody = {
    operationId?: string;
};
export type GitPOSTPushForceBody = {
    operationId?: string;
};
export type GitPOSTSwitchBody = {
    branch: string;
    operationId?: string;
};
export type GitPOSTBranchBody = {
    name: string;
    base?: string;
    operationId?: string;
};
export type GitPOSTCommitMessageResponse = {
    "message": string;
    "violations": ({
        "kind": "forbidden" | "format";
        "severity": "error" | "warning";
        "line": number;
        "text": string;
        "pattern": string;
    })[];
    "cleaned": string;
    "cleanedCoauthors": ({
        "name": string;
        "email": string;
    })[];
};
export type GitPOSTCommitMessageBody = {
    "title": string;
    "body"?: string;
    "includeDescription"?: false | true;
    "includeCoauthors"?: false | true;
    "coauthors"?: ({
        "name": string;
        "email": string;
    })[];
};
export type GitPOSTCommitBody = C.CommitMessageInput & {
    operationId?: string;
    overrideForbidden?: boolean;
};
export type GitPOSTGenerateMessageResponse = {
    "title": string;
    "body": string;
};
export type GitPOSTGenerateMessageBody = {
    "taskId"?: string;
    "workspace"?: string;
    "includeDescription"?: false | true;
};
export type ConflictsGETResponse = {
    "operation": null;
    "files": (never)[];
    "session": null;
} | {
    "operation": C.GitOperationState;
    "files": ({
        "path": string;
        "code": string;
        "conflicted": boolean;
        "note": null | {
            "outcome": "resolved" | "question" | "recommend";
            "text": string;
            "answer": string;
            "answer_sent": boolean;
        };
    })[];
    "session": null | {
        "id": string;
        "status": string;
        "reason": string;
    };
};
export type ConflictsPOSTResolveBody = {
    note?: string;
    answers?: Record<string, string>;
};
export type ConflictsPOSTStopResponse = {
    "stopped": boolean;
};
export interface GitEndpoints {
    "GET /api/projects/:projectId/git/repository": Endpoint<"GET /api/projects/:projectId/git/repository", never, GitGETRepositoryResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/git/settings": Endpoint<"GET /api/projects/:projectId/git/settings", never, GitGETSettingsResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/git/coauthors": Endpoint<"GET /api/projects/:projectId/git/coauthors", never, GitGETCoauthorsResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/git/branches": Endpoint<"GET /api/projects/:projectId/git/branches", never, (C.GitBranch)[], {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/branches/refresh": Endpoint<"POST /api/projects/:projectId/git/branches/refresh", never, (C.GitBranch)[], {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/cancel": Endpoint<"POST /api/projects/:projectId/git/cancel", GitPOSTCancelBody, void, {
        "workspace"?: string;
    }, "empty", never>;
    "POST /api/projects/:projectId/git/stage": Endpoint<"POST /api/projects/:projectId/git/stage", GitPOSTStageBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/unstage": Endpoint<"POST /api/projects/:projectId/git/unstage", GitPOSTUnstageBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/discard": Endpoint<"POST /api/projects/:projectId/git/discard", GitPOSTDiscardBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/fetch": Endpoint<"POST /api/projects/:projectId/git/fetch", GitPOSTFetchBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/pull": Endpoint<"POST /api/projects/:projectId/git/pull", GitPOSTPullBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/push": Endpoint<"POST /api/projects/:projectId/git/push", GitPOSTPushBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/pull-rebase": Endpoint<"POST /api/projects/:projectId/git/pull-rebase", GitPOSTPullRebaseBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/push-force": Endpoint<"POST /api/projects/:projectId/git/push-force", GitPOSTPushForceBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/switch": Endpoint<"POST /api/projects/:projectId/git/switch", GitPOSTSwitchBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/branch": Endpoint<"POST /api/projects/:projectId/git/branch", GitPOSTBranchBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/commit-message": Endpoint<"POST /api/projects/:projectId/git/commit-message", GitPOSTCommitMessageBody, GitPOSTCommitMessageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/commit": Endpoint<"POST /api/projects/:projectId/git/commit", GitPOSTCommitBody, GitPOSTStageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/git/generate-message": Endpoint<"POST /api/projects/:projectId/git/generate-message", GitPOSTGenerateMessageBody, GitPOSTGenerateMessageResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/conflicts": Endpoint<"GET /api/projects/:projectId/conflicts", never, ConflictsGETResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/conflicts/resolve": Endpoint<"POST /api/projects/:projectId/conflicts/resolve", ConflictsPOSTResolveBody, ConflictsGETResponse, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/conflicts/stop": Endpoint<"POST /api/projects/:projectId/conflicts/stop", never, ConflictsPOSTStopResponse, {
        "workspace"?: string;
    }, "json", never>;
}
