export interface MrPreview extends C.CreateMergeRequest {
    head: string;
    task_id?: string;
    connection_id: string;
    project_path: string;
}
export interface TaskMr {
    iid: number;
    web_url: string;
    state: string;
    source_branch?: string;
    target_branch?: string;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type TaskMrPOSTPreviewResponse = {
    "head": string;
    "task_id"?: string;
    "connection_id": string;
    "project_path": string;
    "source_branch": string;
    "target_branch": string;
    "title": string;
    "description"?: string;
    "reviewer_ids"?: (number)[];
    "labels"?: string;
    "reviewer_logins"?: (string)[];
    "assignee_ids"?: (number)[];
    "assignee_logins"?: (string)[];
    "remove_source_branch"?: false | true;
    "squash"?: false | true;
};
export type TaskMrPOSTPreviewBody = {
    "task_id"?: undefined | string;
    "target_branch"?: undefined | string;
};
export type TaskMrPOSTDescribeResponse = {
    "description": string;
};
export type TaskMrPOSTDescribeBody = {
    "head": string;
    "task_id"?: string;
    "connection_id": string;
    "project_path": string;
    "source_branch": string;
    "target_branch": string;
    "title": string;
    "description"?: string;
    "reviewer_ids"?: (number)[];
    "labels"?: string;
    "reviewer_logins"?: (string)[];
    "assignee_ids"?: (number)[];
    "assignee_logins"?: (string)[];
    "remove_source_branch"?: false | true;
    "squash"?: false | true;
};
export type TaskMrPOSTCreateBody = C.MrPreview & {
    confirmed: boolean;
};
export type TaskMrPOSTRefreshBody = {
    "task_id"?: string;
};
export type TaskMrPOSTCloseTaskBody = {
    task_id: string;
    confirmed: boolean;
    delete_branch?: boolean;
};
export interface TaskMrEndpoints {
    "POST /api/projects/:projectId/task-mr/preview": Endpoint<"POST /api/projects/:projectId/task-mr/preview", TaskMrPOSTPreviewBody, TaskMrPOSTPreviewResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/task-mr/describe": Endpoint<"POST /api/projects/:projectId/task-mr/describe", TaskMrPOSTDescribeBody, TaskMrPOSTDescribeResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/task-mr/create": Endpoint<"POST /api/projects/:projectId/task-mr/create", TaskMrPOSTCreateBody, C.MergeRequest, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/task-mr/refresh": Endpoint<"POST /api/projects/:projectId/task-mr/refresh", TaskMrPOSTRefreshBody, null | C.MergeRequest, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/task-mr/close-task": Endpoint<"POST /api/projects/:projectId/task-mr/close-task", TaskMrPOSTCloseTaskBody, null | C.Task, Record<string, never>, "json", never>;
}
