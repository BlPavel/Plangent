export type ReviewTarget = 'plan' | 'architecture' | 'qa';
export interface PlanReviewCoverage {
    requirement: string;
    steps: string[];
    status: 'covered' | 'missing' | 'partial';
    remark_id?: string;
    source?: 'analysis' | 'qa';
    criterion?: string;
}
export interface PlanReview {
    id: string;
    task_id: string;
    target: ReviewTarget;
    plan_version: number;
    round: number;
    session_id: string | null;
    skill_id: string | null;
    overview: string;
    coverage: PlanReviewCoverage[];
    status: 'open' | 'completed' | 'failed';
}
export interface PlanReviewRemark {
    /** steps: pN of a plan, D…/Q… of a document; quote marks a place of a document that has no identifier. */
    id: string;
    steps: {
        id: string;
        deleted: boolean;
    }[];
    quote?: string;
    kind: 'contradiction' | 'order' | 'coverage' | 'extra' | 'unclear' | 'risk' | 'suggestion';
    text: string;
    suggestion: string;
    status: 'open' | 'accepted' | 'discussing' | 'rejected' | 'sent' | 'applied' | 'answered';
    decision: string;
    original: {
        text: string;
        suggestion: string;
    } | null;
    outdated: boolean;
    applied_version: number | null;
    planner_session_id?: string | null;
    messages: {
        id: string;
        author: 'developer' | 'reviewer' | 'planner';
        text: string;
        sent: boolean;
    }[];
}
export interface PlanReviewDetail {
    review: PlanReview;
    remarks: PlanReviewRemark[];
}
export interface PlanReviewSkill {
    id: string;
    title: string;
    origin: 'direct' | 'group' | 'global';
}
export interface LaunchPlanReview {
    agent_id: string;
    model?: string;
    reasoning_effort?: string;
    skill_id?: string;
    wish?: string;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type PlanReviewGETResponse = ({
    "id": string;
    "task_id": string;
    "target": "plan" | "architecture" | "qa";
    "plan_version": number;
    "plan_content": string;
    "round": number;
    "session_id": null | string;
    "skill_id": null | string;
    "overview": string;
    "coverage": ({
        "requirement": string;
        "steps": (string)[];
        "status": "covered" | "missing" | "partial";
        "remark_id"?: string;
        "source"?: "qa" | "analysis";
        "criterion"?: string;
    })[];
    "status": "open" | "completed" | "failed";
    "created_at": string;
})[];
export type PlanReviewPOSTResponse = {
    "review": {
        "id": string;
        "task_id": string;
        "target": "plan" | "architecture" | "qa";
        "plan_version": number;
        "plan_content": string;
        "round": number;
        "session_id": null | string;
        "skill_id": null | string;
        "overview": string;
        "coverage": ({
            "requirement": string;
            "steps": (string)[];
            "status": "covered" | "missing" | "partial";
            "remark_id"?: string;
            "source"?: "qa" | "analysis";
            "criterion"?: string;
        })[];
        "status": "open" | "completed" | "failed";
        "created_at": string;
    };
    "remarks": ({
        "messages": ({
            "id": string;
            "remark_id": string;
            "author": "developer" | "reviewer" | "planner";
            "text": string;
            "sent": boolean;
            "created_at": string;
        })[];
        "id": string;
        "review_id": string;
        "steps": ({
            "id": string;
            "deleted": boolean;
        })[];
        "kind": "coverage" | "suggestion" | "contradiction" | "order" | "extra" | "unclear" | "risk";
        "text": string;
        "suggestion": string;
        "quote": string;
        "status": "open" | "sent" | "accepted" | "discussing" | "rejected" | "applied" | "answered";
        "decision": string;
        "sent_status": null | "accepted" | "discussing";
        "planner_session_id": null | string;
        "outdated": boolean;
        "applied_version": null | number;
        "created_at": string;
        "original": null | {
            "text": string;
            "suggestion": string;
        };
    })[];
};
export type PlanReviewGETSkillsResponse = ({
    "id": string;
    "title": string;
    "description": string;
    "origin": "group" | "global" | "direct";
})[];
export type PlanReviewPUTIdRemarksRidDecisionBody = {
    status: 'accepted' | 'discussing' | 'rejected';
    comment?: string;
};
export type PlanReviewPUTIdRemarksRidTextBody = {
    text: string;
    suggestion?: string;
};
export type PlanReviewPOSTIdRemarksRidMessagesBody = {
    text: string;
};
export type PlanReviewPOSTLaunchResponse = {
    "session_id": string;
    "review": {
        "id": string;
        "task_id": string;
        "target": "plan" | "architecture" | "qa";
        "plan_version": number;
        "plan_content": string;
        "round": number;
        "session_id": null | string;
        "skill_id": null | string;
        "overview": string;
        "coverage": ({
            "requirement": string;
            "steps": (string)[];
            "status": "covered" | "missing" | "partial";
            "remark_id"?: string;
            "source"?: "qa" | "analysis";
            "criterion"?: string;
        })[];
        "status": "open" | "completed" | "failed";
        "created_at": string;
    };
    "remarks": ({
        "messages": ({
            "id": string;
            "remark_id": string;
            "author": "developer" | "reviewer" | "planner";
            "text": string;
            "sent": boolean;
            "created_at": string;
        })[];
        "id": string;
        "review_id": string;
        "steps": ({
            "id": string;
            "deleted": boolean;
        })[];
        "kind": "coverage" | "suggestion" | "contradiction" | "order" | "extra" | "unclear" | "risk";
        "text": string;
        "suggestion": string;
        "quote": string;
        "status": "open" | "sent" | "accepted" | "discussing" | "rejected" | "applied" | "answered";
        "decision": string;
        "sent_status": null | "accepted" | "discussing";
        "planner_session_id": null | string;
        "outdated": boolean;
        "applied_version": null | number;
        "created_at": string;
        "original": null | {
            "text": string;
            "suggestion": string;
        };
    })[];
};
export type PlanReviewPOSTLaunchBody = C.LaunchPlanReview;
export type PlanReviewPOSTIdSendBody = {
    session_id?: string | null;
    agent_id?: string;
    model?: string;
    reasoning_effort?: string;
};
export interface PlanReviewEndpoints {
    "GET /api/projects/:projectId/tasks/:taskId/plan-reviews": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/plan-reviews", never, PlanReviewGETResponse, {
        "target"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/plan-reviews": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/plan-reviews", never, PlanReviewPOSTResponse, {
        "target"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/plan-reviews/skills": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/plan-reviews/skills", never, PlanReviewGETSkillsResponse, {
        "target"?: string;
    }, "json", never>;
    "GET /api/projects/:projectId/tasks/:taskId/plan-reviews/:id": Endpoint<"GET /api/projects/:projectId/tasks/:taskId/plan-reviews/:id", never, PlanReviewPOSTResponse, {
        "target"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/decision": Endpoint<"PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/decision", PlanReviewPUTIdRemarksRidDecisionBody, PlanReviewPOSTResponse, {
        "target"?: string;
    }, "json", never>;
    "PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/text": Endpoint<"PUT /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/text", PlanReviewPUTIdRemarksRidTextBody, PlanReviewPOSTResponse, {
        "target"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/discuss": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/discuss", never, PlanReviewPOSTResponse, {
        "target"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/messages": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/remarks/:rid/messages", PlanReviewPOSTIdRemarksRidMessagesBody, PlanReviewPOSTResponse, {
        "target"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/plan-reviews/launch": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/plan-reviews/launch", PlanReviewPOSTLaunchBody, PlanReviewPOSTLaunchResponse, {
        "target"?: string;
    }, "json", never>;
    "POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/send": Endpoint<"POST /api/projects/:projectId/tasks/:taskId/plan-reviews/:id/send", PlanReviewPOSTIdSendBody, PlanReviewPOSTLaunchResponse, {
        "target"?: string;
    }, "json", never>;
}
