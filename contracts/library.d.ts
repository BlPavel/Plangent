export type LibraryItemType = 'skill' | 'command' | 'main' | 'plan-template' | 'instruction-guide' | 'code-fixer-instruction' | 'commit-rules' | 'review-skill' | 'plan-review-skill' | 'plan-review-instruction' | 'architecture-template' | 'architecture-review-instruction' | 'architecture-review-skill' | 'qa-template' | 'qa-review-instruction' | 'qa-review-skill' | 'interview-instruction';
export type LibraryScope = 'global' | 'project';
export interface LibraryItem {
    origin?: 'global' | 'group' | 'direct';
    content?: string;
    id: string;
    type: LibraryItemType;
    slug: string;
    title: string;
    description: string;
    scope: LibraryScope;
    // Legacy single project; migrated into targets and no longer used.
    project_id: string | null;
    targets: string[];
    // Groups from `targets` whose own folder gets the item but not their projects.
    own_only: string[];
    // Projects taken out of a shared item (they changed or deleted it there).
    excluded: string[];
    // For a project's own copy of a group's item: the item it was detached from.
    detached_from: string | null;
    frontmatter: Record<string, unknown>;
    agent_filter: string[];
    enabled: boolean;
    created_at: string;
    updated_at: string;
}
export type LibraryProposalStatus = 'pending' | 'applied' | 'rejected' | 'stale';
export interface LibraryProposal {
    id: string;
    project_id: string;
    session_id: string;
    status: LibraryProposalStatus;
    action: 'create' | 'update';
    type: 'skill' | 'main' | 'command' | 'review-skill' | 'plan-review-skill' | 'architecture-review-skill' | 'qa-review-skill';
    slug: string;
    title: string;
    description: string;
    frontmatter: Record<string, unknown>;
    content: string;
    scope: LibraryScope;
    targets: string[];
    own_only: string[];
    explanation: string;
    item_id: string | null;
    snapshot: (LibraryItem & {
        content: string;
    }) | null;
    applied_item_id: string | null;
    created_at: string;
    updated_at: string;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type LibraryPOSTProposalsProposalIdApplyResponse = C.LibraryItem & { content: string };
export type LibraryPOSTProposalsProposalIdApplyBody = {
    "availability"?: undefined | {
        "scope": C.LibraryScope;
        "targets": (string)[];
        "own_only"?: (string)[];
    };
};
export type LibraryGETInterviewInstructionDefaultsResponse = {
    "content": string;
};
export type LibraryGETArchitectureTemplateDefaultsResponse = {
    "content": string;
    "lockedProtocol": string;
};
export type LibraryGETPlanTemplateDefaultsResponse = {
    "lockedProtocol": string;
};
export type LibraryGETResponse = ({
    "origin": "group" | "global" | "direct";
    "content"?: string;
    "id": string;
    "type": C.LibraryItemType;
    "slug": string;
    "title": string;
    "description": string;
    "scope": C.LibraryScope;
    "project_id": null | string;
    "targets": (string)[];
    "own_only": (string)[];
    "excluded": (string)[];
    "detached_from": null | string;
    "frontmatter": {
        [key: string]: unknown;
    };
    "agent_filter": (string)[];
    "enabled": boolean;
    "created_at": string;
    "updated_at": string;
})[] | (C.LibraryItem)[];
export type LibraryGETIdResponse = C.LibraryItem & { content: string };
export type LibraryPOSTResponse = C.LibraryItem & { content: string };
export type LibraryPOSTBody = Partial<C.LibraryItem> & {
    type: C.LibraryItemType;
    slug: string;
    title: string;
    content?: string;
};
export type LibraryPUTIdBody = Partial<C.LibraryItem> & {
    content?: string;
};
export type LibraryPOSTIdDetachBody = {
    projectId: string;
};
export type LibraryPOSTIdExcludeResponse = {
    "ok": boolean;
};
export type LibraryPOSTIdExcludeBody = {
    projectId: string;
};
export type LibraryGETIdOverridesAgentTypeResponse = {
    "content": null | string;
};
export type LibraryPUTIdOverridesAgentTypeBody = {
    content: string;
};
export interface LibraryEndpoints {
    "GET /api/library/proposals": Endpoint<"GET /api/library/proposals", never, (C.LibraryProposal)[], {
        "projectId"?: string;
        "sessionId"?: string;
    }, "json", never>;
    "POST /api/library/proposals/:proposalId/apply": Endpoint<"POST /api/library/proposals/:proposalId/apply", LibraryPOSTProposalsProposalIdApplyBody, LibraryPOSTProposalsProposalIdApplyResponse, Record<string, never>, "json", never>;
    "POST /api/library/proposals/:proposalId/reject": Endpoint<"POST /api/library/proposals/:proposalId/reject", never, C.LibraryProposal, Record<string, never>, "json", never>;
    "GET /api/library/interview-instruction/defaults": Endpoint<"GET /api/library/interview-instruction/defaults", never, LibraryGETInterviewInstructionDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/code-fixer-instruction/defaults": Endpoint<"GET /api/library/code-fixer-instruction/defaults", never, LibraryGETInterviewInstructionDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/commit-rules/defaults": Endpoint<"GET /api/library/commit-rules/defaults", never, LibraryGETInterviewInstructionDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/plan-review-instruction/defaults": Endpoint<"GET /api/library/plan-review-instruction/defaults", never, LibraryGETInterviewInstructionDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/architecture-review-instruction/defaults": Endpoint<"GET /api/library/architecture-review-instruction/defaults", never, LibraryGETInterviewInstructionDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/qa-review-instruction/defaults": Endpoint<"GET /api/library/qa-review-instruction/defaults", never, LibraryGETInterviewInstructionDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/architecture-template/defaults": Endpoint<"GET /api/library/architecture-template/defaults", never, LibraryGETArchitectureTemplateDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/qa-template/defaults": Endpoint<"GET /api/library/qa-template/defaults", never, LibraryGETArchitectureTemplateDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/instruction-guide/defaults": Endpoint<"GET /api/library/instruction-guide/defaults", never, LibraryGETInterviewInstructionDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library/plan-template/defaults": Endpoint<"GET /api/library/plan-template/defaults", never, LibraryGETPlanTemplateDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/library": Endpoint<"GET /api/library", never, LibraryGETResponse, { type?: string; scope?: string; projectId?: string; forProject?: string }, "json", never>;
    "GET /api/library/:id": Endpoint<"GET /api/library/:id", never, LibraryGETIdResponse, Record<string, never>, "json", never>;
    "POST /api/library": Endpoint<"POST /api/library", LibraryPOSTBody, LibraryPOSTResponse, Record<string, never>, "json", never>;
    "PUT /api/library/:id": Endpoint<"PUT /api/library/:id", LibraryPUTIdBody, LibraryPOSTResponse, Record<string, never>, "json", never>;
    "POST /api/library/:id/detach": Endpoint<"POST /api/library/:id/detach", LibraryPOSTIdDetachBody, LibraryGETIdResponse, Record<string, never>, "json", never>;
    "POST /api/library/:id/exclude": Endpoint<"POST /api/library/:id/exclude", LibraryPOSTIdExcludeBody, LibraryPOSTIdExcludeResponse, Record<string, never>, "json", never>;
    "DELETE /api/library/:id": Endpoint<"DELETE /api/library/:id", never, LibraryPOSTIdExcludeResponse, Record<string, never>, "json", never>;
    "GET /api/library/:id/overrides/:agentType": Endpoint<"GET /api/library/:id/overrides/:agentType", never, LibraryGETIdOverridesAgentTypeResponse, Record<string, never>, "json", never>;
    "PUT /api/library/:id/overrides/:agentType": Endpoint<"PUT /api/library/:id/overrides/:agentType", LibraryPUTIdOverridesAgentTypeBody, LibraryPOSTIdExcludeResponse, Record<string, never>, "json", never>;
    "DELETE /api/library/:id/overrides/:agentType": Endpoint<"DELETE /api/library/:id/overrides/:agentType", never, LibraryPOSTIdExcludeResponse, Record<string, never>, "json", never>;
    "POST /api/library/sync": Endpoint<"POST /api/library/sync", never, LibraryPOSTIdExcludeResponse, Record<string, never>, "json", never>;
}
