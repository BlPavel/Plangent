import type { FinishScenario } from './index';
export interface Task {
    kind: 'task' | 'errand';
    auto_review: boolean;
    /** The review agent chosen when the work was created; null — the project's review agent. */
    review_agent?: import('./work').ErrandReviewAgent | null;
    closed_at: string | null;
    close_reason: 'done' | 'cancelled' | null;
    origin_task_id: string | null;
    base_commit?: string | null;
    external_key?: string | null;
    base_branch?: string | null;
    mr_link?: string | null;
    id: string;
    project_id: string;
    key: string;
    title?: string;
    description?: string;
    jira_url?: string;
    branch_name?: string;
    finish_scenario?: FinishScenario | null;
    target_branch?: string | null;
    status: 'open' | 'in_progress' | 'done';
    created_at: string;
}
export interface Plan {
    steps: PlanStep[];
    session_id: string | null;
    author: 'agent' | 'developer';
    id: string;
    task_id: string;
    content: string;
    version: number;
    created_at: string;
    updated_at: string;
}
export interface PlanStep {
    text: string;
    done: boolean;
    index: number;
    id?: string; // stable (pN) id
    analysisLinks?: string[];
    parallelGroup?: string; // @parallel:<groupName>
}
export interface AnalysisSection {
    files: AnalysisFile[];
    id: string;
    task_id: string;
    slug: string;
    title: string;
    description: string;
    kind: 'source' | 'worked';
    author: 'developer' | 'agent';
    position: number;
    created_at: string;
    updated_at: string;
}
export interface AnalysisFile {
    id: string;
    section_id: string;
    name: string;
    mime: string;
    size: number;
    created_at: string;
}
export interface TaskAgentLaunchResult {
    session_id: string;
    mode: 'acp';
    prompt?: string;
}
export type MaterialType = 'architecture' | 'qa';
export interface Material {
    id: string;
    task_id: string;
    type: MaterialType;
    content: string;
    version: number;
    author: 'developer' | 'agent';
    session_id: string | null;
    created_at: string;
}
export type PreparationStage = 'analysis' | 'architecture' | 'qa' | 'plan';
export interface StageSummary {
    stage: PreparationStage;
    status: 'not_started' | 'draft' | 'ready' | 'skipped';
    material_version: string;
    marked_version: string | null;
    marked_at: string | null;
    changed_since_mark: boolean;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type TasksPOSTTaskIdMoveBody = {
    project_id: string;
};
export type TasksPOSTTaskIdBranchBody = {
    name: string;
    base?: string;
};
export type TasksPOSTBody = Partial<Omit<C.Task, "id" | "project_id" | "created_at">>;
export type TasksPATCHTaskIdBody = Partial<Omit<C.Task, "id" | "project_id" | "created_at">>;
export type PlansGETResponse = ({
    "id": string;
    "task_id": string;
    "author": "developer" | "agent";
    "created_at": string;
    "updated_at": string;
    "content": string;
    "session_id": null | string;
    "version": number;
})[];
export type PlansGETLatestResponse = {
    "steps": (C.PlanStep)[];
    "id": string;
    "task_id": string;
    "author": "developer" | "agent";
    "created_at": string;
    "updated_at": string;
    "content": string;
    "session_id": null | string;
    "version": number;
};
export type PlansPOSTBody = {
    content: string;
};
export type PlansPATCHPlanIdBody = {
    content: string;
};
export type PlansPATCHPlanIdStepStepIndexBody = {
    "done"?: boolean;
};
export type AnalysisGETResponse = ({
    "files": ({
        "id": string;
        "section_id": string;
        "name": string;
        "mime": string;
        "size": number;
        "created_at": string;
    })[];
    "id": string;
    "kind": "source" | "worked";
    "task_id": string;
    "slug": string;
    "title": string;
    "description": string;
    "author": "developer" | "agent";
    "position": number;
    "created_at": string;
    "updated_at": string;
})[];
export type AnalysisPOSTResponse = {
    "id": string;
    "kind": "source" | "worked";
    "task_id": string;
    "slug": string;
    "title": string;
    "description": string;
    "author": "developer" | "agent";
    "position": number;
    "created_at": string;
    "updated_at": string;
};
export type AnalysisPOSTBody = {
    title: string;
    description?: string;
    kind?: "source" | "worked";
};
export type AnalysisPOSTReorderResponse = ({
    "id": string;
    "kind": "source" | "worked";
    "task_id": string;
    "slug": string;
    "title": string;
    "description": string;
    "author": "developer" | "agent";
    "position": number;
    "created_at": string;
    "updated_at": string;
})[];
export type AnalysisPOSTReorderBody = {
    ids: string[];
};
export type AnalysisGETSectionIdResponse = {
    "files": ({
        "id": string;
        "section_id": string;
        "name": string;
        "mime": string;
        "size": number;
        "created_at": string;
    })[];
    "id": string;
    "kind": "source" | "worked";
    "task_id": string;
    "slug": string;
    "title": string;
    "description": string;
    "author": "developer" | "agent";
    "position": number;
    "created_at": string;
    "updated_at": string;
};
export type AnalysisPATCHSectionIdBody = {
    title?: string;
    description?: string;
    kind?: "source" | "worked";
};
export type AnalysisGETSectionIdFilesResponse = ({
    "id": string;
    "section_id": string;
    "name": string;
    "mime": string;
    "size": number;
    "created_at": string;
})[];
export type AnalysisPOSTSectionIdFilesResponse = {
    "id": string;
    "section_id": string;
    "name": string;
    "mime": string;
    "size": number;
    "created_at": string;
};
export type AnalysisPOSTSectionIdFilesBody = {
    name: string;
    data: string;
    mime?: string;
};
export type MaterialsPUTTypeBody = {
    "content"?: string;
    "expected_version"?: undefined | number;
};
export type MaterialsGETResponse = ({
    "stage": "plan" | "architecture" | "qa" | "analysis";
    "status": C.StageSummary['status'];
    "material_version": string;
    "marked_version": null | string;
    "marked_at": null | string;
    "changed_since_mark": boolean;
})[];
export type MaterialsPOSTStageBody = {
    "status"?: "ready" | "skipped";
};
export type RunsPOSTResponse = { session_id: string; mode: 'acp'; prompt?: string };
export type RunsPOSTBody = {
    agent_id?: string;
    model?: string;
    reasoning_effort?: string;
    purpose?: 'analysis' | 'plan' | 'execute' | 'preflight' | 'architecture' | 'qa';
    mode?: string;
    config?: Record<string, string>;
};
export interface TasksEndpoints {
    "POST /api/projects/:projectId/tasks/:taskId/base-commit": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/base-commit", never, C.Task, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks": Endpoint<"GET /api/projects/:projectId/tasks", never, (C.Task)[], {
        "members"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/move": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/move", TasksPOSTTaskIdMoveBody, C.Task, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/branch": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/branch", TasksPOSTTaskIdBranchBody, null | C.Task, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId": Endpoint<"GET /api/projects/:projectId/tasks/:taskId", never, C.Task, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks": Endpoint<"POST /api/projects/:projectId/tasks", TasksPOSTBody, C.Task, Record<string, never>, "json", never>;
    "PATCH /api/projects/:projectId/tasks/:taskId": Endpoint<"PATCH /api/projects/:projectId/tasks/:taskId", TasksPATCHTaskIdBody, C.Task, Record<string, never>, "json", never>;
    "DELETE /api/projects/:projectId/tasks/:taskId": Endpoint<"DELETE /api/projects/:projectId/tasks/:taskId", never, void, {
        "discard"?: string;
    }, "empty", never>;
    "GET /api/projects/:projectId/tasks/:taskId/plans": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/plans", never, PlansGETResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/plans/latest": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/plans/latest", never, PlansGETLatestResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/plans": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/plans", PlansPOSTBody, PlansGETLatestResponse, Record<string, never>, "json", never>;
    "PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId": Endpoint<"PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId", PlansPATCHPlanIdBody, PlansGETLatestResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/plans/:planId/step/:stepIndex/done": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/plans/:planId/step/:stepIndex/done", never, PlansGETLatestResponse, Record<string, never>, "json", never>;
    "PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId/step/:stepIndex": Endpoint<"PATCH /api/projects/:projectId/tasks/:taskId/plans/:planId/step/:stepIndex", PlansPATCHPlanIdStepStepIndexBody, PlansGETLatestResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/analysis": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/analysis", never, AnalysisGETResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/analysis": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/analysis", AnalysisPOSTBody, AnalysisPOSTResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/analysis/reorder": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/analysis/reorder", AnalysisPOSTReorderBody, AnalysisPOSTReorderResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/analysis/:sectionId": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/analysis/:sectionId", never, AnalysisGETSectionIdResponse, Record<string, never>, "json", never>;
    "PATCH /api/projects/:projectId/tasks/:taskId/analysis/:sectionId": Endpoint<"PATCH /api/projects/:projectId/tasks/:taskId/analysis/:sectionId", AnalysisPATCHSectionIdBody, AnalysisPOSTResponse, Record<string, never>, "json", never>;
    "DELETE /api/projects/:projectId/tasks/:taskId/analysis/:sectionId": Endpoint<"DELETE /api/projects/:projectId/tasks/:taskId/analysis/:sectionId", never, void, {
        confirm?: string;
    }, "empty", never>;
    "GET /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files", never, AnalysisGETSectionIdFilesResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files", AnalysisPOSTSectionIdFilesBody, AnalysisPOSTSectionIdFilesResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files/:fileId": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files/:fileId", never, void, {
        "download"?: string;
    }, "file", never>;
    "DELETE /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files/:fileId": Endpoint<"DELETE /api/projects/:projectId/tasks/:taskId/analysis/:sectionId/files/:fileId", never, void, {
        confirm?: string;
    }, "empty", never>;
    "GET /api/projects/:projectId/tasks/:taskId/materials/:type": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/materials/:type", never, null | C.Material, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/tasks/:taskId/materials/:type": Endpoint<"PUT /api/projects/:projectId/tasks/:taskId/materials/:type", MaterialsPUTTypeBody, C.Material, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/preparation": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/preparation", never, MaterialsGETResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/preparation/:stage": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/preparation/:stage", MaterialsPOSTStageBody, MaterialsGETResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/runs": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/runs", RunsPOSTBody, RunsPOSTResponse, Record<string, never>, "json", never>;
}
