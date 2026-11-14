import type { Task } from './index';
export interface Workspace {
    id: string;
    project_id: string;
    task_id: string;
    branch: string;
    base_branch: string;
    path: string;
    // 0 is the main folder; each active workspace of a project gets its own slot, so its ports differ.
    port_slot: number;
    status: 'preparing' | 'ready' | 'failed' | 'removed';
    // 0 until files, dependency folders and the setup command are prepared; that happens when the work starts executing.
    setup_done: number;
    error: string;
    setup_log: string;
    created_at: string;
    removed_at: string | null;
}
export type WorkGroup = 'attention' | 'working' | 'preparation' | 'done';
export type WorkStage = 'plan' | 'execution' | 'check' | 'done';
export interface WorkState {
    stage: WorkStage;
    status: 'draft' | 'preparing' | 'waiting' | 'running' | 'reviewing' | 'ready' | 'fixes' | 'finishing' | 'failed' | 'closed';
    group: WorkGroup;
    icon: '○' | '◌' | '❗' | '✓' | '✎' | '⇪' | '✔' | '🤖';
    text: string;
    action: 'plan' | 'queue' | 'chat' | 'check' | 'recreate' | 'reopen' | 'errand';
    actionLabel: string;
    hasBranch: boolean;
    agentWorking: boolean;
    /** The agent has done the work at least once (an errand's first turn, a plan's queue): Проверка opens. */
    canCheck: boolean;
    counts: {
        steps: number;
        completed: number;
        remarks: number;
        waiting: number;
        agents: number;
    };
}
export interface WorkEntry {
    task: Task;
    workspace: Workspace | null;
    state: WorkState;
    /** A task's preparation stages (Анализ, Архитектура, QA, План); absent for an errand. */
    stages?: import('./tasks').StageSummary[];
}
export type ErrandPlace = 'new' | 'existing' | 'main';
export interface ErrandReviewAgent {
    agent_id: string;
    model?: string;
    effort?: string;
}
export interface ErrandInput {
    /** Описание: what the developer sees in the list; the details go to the chat. */
    title?: string;
    external_key?: string;
    /** A ready request (e.g. «Поручение по этой работе»): sent to the agent right away. */
    text?: string;
    agent_id?: string;
    model?: string;
    policy?: string;
    mode?: string;
    config?: Record<string, string>;
    auto_review?: boolean;
    /** Who reviews the work: the agent shown at creation (the project's review agent by default). */
    review_agent?: ErrandReviewAgent;
    place?: ErrandPlace;
    base_branch?: string;
    branch_name?: string;
    branch?: string;
}
/** A task with a plan: its branch and automatic review are chosen at creation, as for an errand. */
export interface PlanTaskInput {
    title?: string;
    external_key?: string;
    auto_review?: boolean;
    review_agent?: ErrandReviewAgent;
    /** Omitted: the branch is chosen when the execution starts (a group's work). */
    place?: ErrandPlace;
    base_branch?: string;
    branch_name?: string;
    branch?: string;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type WorkspacesPUTViewingResponse = {
    "workspace": null | C.Workspace;
    "warnings": {
        "agentWorking": boolean;
        "terminals": ({
            "processes": ({
                "pid": number;
                "name": string;
            })[];
            "id": string;
            "projectId": string;
            "title": string;
            "shell": string;
            "cwd": string;
            "workspaceId": null | string;
        })[];
    };
};
export type WorkspacesPUTViewingBody = {
    workspaceId?: string | null;
    confirmed?: boolean;
};
export type WorkspacesPOSTIdRecreateBody = {
    discard?: boolean;
};
export type WorkPOSTErrandsResponse = {
    task: C.Task;
};
export type WorkPOSTErrandsBody = C.ErrandInput;
export type WorkPOSTPlanTasksResponse = {
    task: C.Task;
};
export type WorkPOSTPlanTasksBody = C.PlanTaskInput;
export type WorkPOSTTasksTaskIdChatBody = {
    agent_id?: string;
    /** Start a new follow-up agent of a task even though one exists; the old chat stays as a journal. */
    replace?: boolean;
    model?: string;
    reasoning_effort?: string;
};
/** The range of a work's review: `task` — everything since the work began, `worktree` — uncommitted changes only, `branch` — against a branch. */
export type WorkReviewMode = 'task' | 'worktree' | 'branch';
export type WorkPOSTTasksTaskIdReviewBody = {
    agent_id?: string;
    model?: string;
    effort?: string;
    config?: Record<string, string>;
    skill_id?: string;
    mode?: WorkReviewMode;
    ref?: string;
    /** What the agent should know about the changes (free text). */
    context?: string;
};
export type WorkCheck = {
    "changes": ({
        "file": string;
        "diff": string;
    })[];
    "workspace_id": undefined | string;
    "reviewers": (C.AgentSession)[];
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
export type WorkGETTasksTaskIdCheckFileResponse = C.CodeFile | {
    "path": string;
    "kind": "text";
    "content": string;
    "size": number;
};
export type WorkPOSTTasksTaskIdCheckSendBody = {
    agent_id?: string;
    item_ids: string[];
};
export type WorkGETAttentionResponse = ({
    "projectId": string;
    "count": number;
})[];
export type WorkGETWorkResponse = ({
    "task": C.Task;
    "workspace": null | C.Workspace;
    "state": C.WorkState;
})[];
export type WorkPOSTTasksTaskIdCloseBody = {
    discard?: boolean;
};
export type WorkPOSTTasksTaskIdCancelBody = {
    mode: 'discard' | 'keep';
};
export type WorkPOSTTasksTaskIdErrandResponse = {
    task: C.Task;
    session: C.AgentSession;
};
export type WorkPOSTTasksTaskIdErrandBody = C.ErrandInput;
export interface WorkEndpoints {
    "POST /api/projects/:projectId/tasks/:taskId/switch-branch": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/switch-branch", { branch: string; create?: boolean; base?: string }, { task: C.Task; workspace: C.Workspace }, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/workspaces": Endpoint<"GET /api/projects/:projectId/workspaces", never, (C.Workspace)[], Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/workspaces/viewing": Endpoint<"GET /api/projects/:projectId/workspaces/viewing", never, null | C.Workspace, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/workspaces/viewing": Endpoint<"PUT /api/projects/:projectId/workspaces/viewing", WorkspacesPUTViewingBody, WorkspacesPUTViewingResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/workspaces/:id/recreate": Endpoint<"POST /api/projects/:projectId/workspaces/:id/recreate", WorkspacesPOSTIdRecreateBody, C.Workspace, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/errands": Endpoint<"POST /api/projects/:projectId/errands", WorkPOSTErrandsBody, WorkPOSTErrandsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/plan-tasks": Endpoint<"POST /api/projects/:projectId/plan-tasks", WorkPOSTPlanTasksBody, WorkPOSTPlanTasksResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/chat": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/chat", WorkPOSTTasksTaskIdChatBody, C.AgentSession, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/review": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/review", WorkPOSTTasksTaskIdReviewBody, C.AgentSession, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/check": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/check", never, WorkCheck, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/check/file": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/check/file", never, WorkGETTasksTaskIdCheckFileResponse, {
        "file"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/check/send": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/check/send", WorkPOSTTasksTaskIdCheckSendBody, C.AgentSession, Record<string, never>, "json", never>;
    "GET /api/work/attention": Endpoint<"GET /api/work/attention", never, WorkGETAttentionResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/work": Endpoint<"GET /api/projects/:projectId/work", never, WorkGETWorkResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/close": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/close", WorkPOSTTasksTaskIdCloseBody, C.Task, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/cancel": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/cancel", WorkPOSTTasksTaskIdCancelBody, C.Task, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/add-plan": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/add-plan", never, C.Task, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/errand": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/errand", WorkPOSTTasksTaskIdErrandBody, WorkPOSTTasksTaskIdErrandResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/reopen": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/reopen", never, C.Task, Record<string, never>, "json", never>;
}
