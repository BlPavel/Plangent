export type FinishScenario = 'nothing' | 'commits' | 'push' | 'full';
export type FinishStage = 'branch' | 'commits' | 'confirmation' | 'push' | 'mr' | 'done';
export type FinishStatus = 'running' | 'waiting' | 'error' | 'complete' | 'cancelled';
export interface FinishCommit {
    files: string[];
    title: string;
    body?: string;
    sha?: string;
}
export interface FinishOptions {
    scenario: FinishScenario;
    task_id?: string;
    includeDescription?: boolean;
    includeCoauthors?: boolean;
    coauthors?: {
        name: string;
        email: string;
    }[];
    targetBranch?: string;
    branchName?: string;
    /** The branch the new working branch starts from; the current one by default. */
    baseBranch?: string;
    /** single — everything in one commit; split — the agent decides how many commits. */
    commitMode?: 'single' | 'split';
    /** Continue the selected scenario without pausing for review. */
    autoContinue?: boolean;
}
export interface FinishMrDraft {
    title: string;
    description: string;
}
export interface FinishRun {
    workspace_id?: string | null;
    id: string;
    project_id: string;
    task_id: string | null;
    scenario: Exclude<FinishScenario, 'nothing'>;
    options: FinishOptions;
    base_head: string;
    branch: string;
    snapshot_tree: string;
    stage: FinishStage;
    status: FinishStatus;
    commits: FinishCommit[];
    session_id: string | null;
    note: string;
    error: string;
    output: string;
    pushed: boolean;
    mr_url: string | null;
    mr_draft: FinishMrDraft | null;
    /** Files a git hook changed right after a commit; set until the user adopts the changes or cancels. */
    hook_changes: string[];
    created_at: string;
    updated_at: string;
}
export type CommitMode = 'single' | 'split';
export interface FinishContext {
    diffs: Record<string, string>;
    changes: {
        path: string;
        originalPath?: string;
        status: string;
    }[];
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type FinishGETTaskTaskIdResponse = null | {
    "id": string;
    "project_id": string;
    "stage": C.FinishStage;
    "status": C.FinishStatus;
    "error": string;
};
export type FinishGETIdContextResponse = {
    "changes": (C.GitChange)[];
    "diffs": {
        [key: string]: string;
    };
    "diffLimit": number;
    "settings": {
        "commit_pattern": string;
        "workspace_copy_files": (string)[];
        "workspace_link_dirs": (string)[];
        "workspace_setup_command": string;
        "workspace_ports": (string)[];
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
    "commit_rules": string;
    "options": C.FinishOptions;
    "task": null | {
        "key": string;
        "title": undefined | string;
        "description": undefined | string;
    };
    "commits": (C.FinishCommit)[];
    "note": string;
    "mr": null | {
        "draft": null | C.FinishMrDraft;
        "template": null | {
            "title": string;
            "description": undefined | string;
        };
    };
};
export type FinishPUTIdCommitsBody = {
    commits: C.FinishCommit[];
    overrideForbidden?: boolean;
    /** Commit without running the repository's git hooks. Only the user may ask for it, never the agent. */
    skipHooks?: boolean;
};
export type FinishPUTIdMergeRequestBody = C.FinishMrDraft;
export type FinishPOSTIdReviseBody = {
    "note"?: string;
};
export type FinishPOSTIdRollbackBody = {
    confirmed: boolean;
};
export type FinishPOSTIdCancelBody = {
    /** Also remove the commits this finish created (the files stay in the working folder). */
    reset?: boolean;
};
export interface FinishEndpoints {
    "GET /api/projects/:projectId/finish": Endpoint<"GET /api/projects/:projectId/finish", never, null | C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/finish": Endpoint<"POST /api/projects/:projectId/finish", C.FinishOptions, null | C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/finish/task/:taskId": Endpoint<"GET /api/projects/:projectId/finish/task/:taskId", never, FinishGETTaskTaskIdResponse, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/finish/:id": Endpoint<"GET /api/projects/:projectId/finish/:id", never, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/finish/:id/context": Endpoint<"GET /api/projects/:projectId/finish/:id/context", never, FinishGETIdContextResponse, {
        "workspace"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/finish/:id/commits": Endpoint<"PUT /api/projects/:projectId/finish/:id/commits", FinishPUTIdCommitsBody, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/finish/:id/merge-request": Endpoint<"PUT /api/projects/:projectId/finish/:id/merge-request", FinishPUTIdMergeRequestBody, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/finish/:id/revise": Endpoint<"POST /api/projects/:projectId/finish/:id/revise", FinishPOSTIdReviseBody, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/finish/:id/accept": Endpoint<"POST /api/projects/:projectId/finish/:id/accept", never, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/finish/:id/rollback": Endpoint<"POST /api/projects/:projectId/finish/:id/rollback", FinishPOSTIdRollbackBody, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/finish/:id/cancel": Endpoint<"POST /api/projects/:projectId/finish/:id/cancel", FinishPOSTIdCancelBody, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/finish/:id/adopt-hook-changes": Endpoint<"POST /api/projects/:projectId/finish/:id/adopt-hook-changes", never, C.FinishRun, {
        "workspace"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/finish/:id/cancel-operation": Endpoint<"POST /api/projects/:projectId/finish/:id/cancel-operation", never, void, {
        "workspace"?: string;
    }, "empty", never>;
}
