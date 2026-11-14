import type { Task, PlanStep, TaskQueue, MaterialType, StageSummary } from './index';
export interface QueueEventBase {
    taskId: string;
    projectId?: string;
    taskKey?: string;
}
export type OrchestratorEvent = QueueEventBase & ({
    type: 'queue_updated';
    queue: TaskQueue;
} | {
    type: 'session_started';
    sessionId: string;
    terminalSessionId: string;
    mode: 'acp';
    points: string[];
} | {
    type: 'session_ready_for_execution';
    sessionId: string;
    message: string;
} | {
    type: 'session_complete';
    sessionId: string;
} | {
    type: 'session_waiting';
    sessionId: string;
    message: string;
} | {
    type: 'session_failed';
    sessionId: string;
    reason: string;
} | {
    type: 'queue_finished';
    failed: number;
    remarks?: number;
} | {
    type: 'queue_paused';
    stageIndex: number;
} | {
    type: 'run_failed';
    reason: string;
} | {
    type: 'analysis_updated';
    actor: 'developer' | 'agent';
} | {
    type: 'task_status';
    status: Task['status'];
} | {
    type: 'task_updated';
}
// idMap: old → new step ids when the planner's plan was renumbered in order.
 | {
    type: 'plan_updated';
    content?: string;
    steps: PlanStep[];
    idMap?: Record<string, string>;
} | {
    type: 'material_updated';
    materialType: MaterialType;
    version: number;
} | {
    type: 'stages_updated';
    stages: StageSummary[];
});
import type { Workspace } from './work';
export interface ServerEvent {
    type: string;
    projectId?: string;
    taskId?: string;
    taskKey?: string;
    workspace?: Workspace | null;
}
export interface CodeChangeEvent { type: 'code:changed'; projectId: string; workspaceId?: string }
export type WorkEvent = ServerEvent & {
    type: 'work:update' | 'work:ready_for_check' | 'work:fixes_ready';
};
export type WorkspaceEvent = ServerEvent & {
    type: 'workspace:update' | 'workspace:viewing';
    projectId: string;
    workspace: Workspace | null;
};
