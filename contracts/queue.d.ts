import type { Agent } from './index';
export type OrchestratorSessionStatus = 'queued' | 'reviewing' | 'ready_for_execution' | 'running' | 'waiting_for_developer' | 'complete' | 'failed' | 'stopped';
export type QueueSessionMode = 'execute' | 'review_first';
export type ExecutionPolicy = 'allow-all' | 'allow-edits' | 'ask';
export interface OrchestratorQueueSession {
    id: string;
    kind?: 'steps' | 'review';
    points?: string[]; // point ids (pN), absent for review
    skillId?: string;
    reviewId?: string;
    remarks?: number;
    agentId: string;
    queueMode: QueueSessionMode;
    permissionPolicy: ExecutionPolicy;
    status: OrchestratorSessionStatus;
    reason?: string;
    // Per-run override of the agent's configured model/reasoning_effort
    // (see Agent.model / Agent.reasoning_effort) — leave unset to use the agent's default.
    model?: string;
    reasoningEffort?: string;
    runId?: string;
    sessionId?: string;
    mode?: 'acp';
}
export interface QueueStage {
    id: string;
    sessions: OrchestratorQueueSession[];
    // Pause the queue once this stage is done, so the developer can review before the next one.
    pauseAfter: boolean;
}
export interface QueueRun {
    id: string;
    finishedAt: string;
    stages: QueueStage[];
}
export type QueueStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'finished' | 'failed';
export interface TaskQueue {
    taskId: string;
    projectId: string;
    status: QueueStatus;
    stages: QueueStage[];
    // Index of the stage being executed (running/paused only).
    stageIndex: number;
    // "Pause after the current stage" requested while running.
    pauseRequested: boolean;
    reason?: string;
    // Earlier runs, newest first (see archiveFinished).
    history?: QueueRun[];
    updatedAt: string;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type OrchestratorGETBlockedResponse = ({
    "projectId": string;
    "taskId": string;
    "taskKey": string;
    "reason": string;
})[];
export type OrchestratorGETActiveResponse = ({
    "projectId": string;
    "taskId": string;
    "taskKey": string;
})[];
export type OrchestratorPUTQueueBody = {
    "stages": ({
        "id"?: string;
        "pauseAfter"?: false | true;
        "sessions": ({
            "id"?: string;
            "kind"?: "review" | "steps";
            "points"?: (string)[];
            "skillId"?: string;
            "reviewId"?: string;
            "remarks"?: number;
            "agentId": string;
            "queueMode"?: "execute" | "review_first";
            "permissionPolicy"?: "ask" | "allow-edits" | "allow-all";
            "status"?: "running" | "failed" | "complete" | "stopped" | "reviewing" | "queued" | "ready_for_execution" | "waiting_for_developer";
            "reason"?: string;
            "model"?: string;
            "reasoningEffort"?: string;
            "runId"?: string;
            "sessionId"?: string;
            "mode"?: "acp";
        })[];
    })[];
};
export type OrchestratorPOSTQueuePauseBody = {
    on?: boolean;
};
export type QueueStartBody = {
    base_branch?: string;
    branch_name?: string;
    branch?: string;
    place?: 'new' | 'existing' | 'main';
    auto_review?: boolean;
};
export interface QueueEndpoints {
    "GET /api/queues/blocked": Endpoint<"GET /api/queues/blocked", never, OrchestratorGETBlockedResponse, Record<string, never>, "json", never>;
    "GET /api/queues/active": Endpoint<"GET /api/queues/active", never, OrchestratorGETActiveResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/queue": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/queue", never, C.TaskQueue, Record<string, never>, "json", never>;
    "PUT /api/projects/:projectId/tasks/:taskId/queue": Endpoint<"PUT /api/projects/:projectId/tasks/:taskId/queue", OrchestratorPUTQueueBody, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/start": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/start", QueueStartBody, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/clear-history": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/clear-history", never, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/stop": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/stop", never, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/pause": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/pause", OrchestratorPOSTQueuePauseBody, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/resume": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/resume", never, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/complete": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/complete", never, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/execute": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/execute", never, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/skip": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/skip", never, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/restart": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/queue/sessions/:sessionId/restart", never, C.TaskQueue, Record<string, never>, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/done": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/done", never, null | C.Task, Record<string, never>, "json", never>;
}
