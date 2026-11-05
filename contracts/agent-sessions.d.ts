export interface ChatSession {
    id: string;
    project_id: string;
    task_id: string | null;
    agent_id: string;
    model: string;
    title: string;
    status: string;
    reason: string;
    policy: string;
    role: string;
    metadata: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
}
export interface ChatPayload {
    gitReason?: string;
    operationId?: string;
    output?: string;
    state?: string;
    link?: string;
    text?: string;
    toolCallId?: string;
    title?: string;
    status?: string;
    kind?: string;
    rawOutput?: unknown;
    content?: {
        type: string;
        path?: string;
        oldText?: string;
        newText?: string;
        content?: {
            text?: string;
        };
    }[];
    entries?: {
        status: string;
        content: string;
    }[];
    availableCommands?: {
        name: string;
        description: string;
    }[];
    file?: string;
    line?: number;
    severity?: string;
    message?: string;
    verdict?: string;
    summary?: string;
    question?: string;
    note?: string;
    /** propose_library_change: the proposal the card shows. */
    proposal_id?: string;
    /** The user message also carried Plangent's hidden briefing. */
    briefing?: boolean;
    permissionId?: string;
}
export interface LimitWindow {
    id: string;
    label: string;
    percent: number;
    resetsAt: number | null;
}
export interface AgentLimits {
    agentId: string;
    at: number;
    windows: LimitWindow[];
    error?: string;
}
export interface ChatEvent {
    seq: number;
    session_id: string;
    type: string;
    payload: ChatPayload;
}
export type SocketMessage = {
    type: 'agent_delta';
    kind: string;
    text: string;
} | {
    type: 'agent_event';
    event: ChatEvent;
};
export interface ChatSnapshot {
  commands?: AgentSessionsGETIdResponse['commands'];
  session: ChatSession;
  events: ChatEvent[];
  queue: AgentSessionsGETIdResponse['queue'];
  streaming: AgentSessionsGETIdResponse['streaming'];
  permissions: AgentSessionsGETIdResponse['permissions'];
}
export type PermissionPolicy = 'ask' | 'allow-edits' | 'allow-all' | 'read-only';
export type SessionStatus = 'starting' | 'thinking' | 'waiting' | 'ready' | 'complete' | 'error';
export interface AgentSession {
    id: string;
    project_id: string;
    task_id: string | null;
    step_ids: string[];
    role: 'errand' | 'task-chat' | 'task-reviewer' | 'plan-reviewer' | 'chat' | 'analyst' | 'material-author' | 'planner' | 'executor' | 'librarian' | 'code-fixer' | 'committer' | 'conflict-resolver';
    agent_id: string;
    model: string;
    acp_session_id: string | null;
    title: string;
    status: SessionStatus;
    reason: string;
    policy: PermissionPolicy;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}
export interface SessionEvent {
    session_id: string;
    seq: number;
    type: string;
    payload: Record<string, unknown>;
    created_at: string;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type AgentSessionsPOSTBody = {
    workspace_id?: string | null;
    workspace?: string | null;
    project_id: string;
    agent_id: string;
    model?: string;
    mode?: string;
    config?: Record<string, string>;
    task_id?: string;
    role?: string;
    title?: string;
    policy?: C.PermissionPolicy;
    text?: string;
};
export type AgentSessionsGETIdResponse = {
    "events": (C.SessionEvent)[];
    "session": C.AgentSession;
    "commands": ({
        "name": string;
        "description": string;
        "source": "plangent";
    })[];
    "queue": ({
        "id": string;
        "session_id": string;
        "content": string;
    })[];
    "streaming": null | {
        "text": string;
        "type": string;
    };
    "permissions": ({
        "sessionId": string;
        "toolCall": {
            "toolCallId": string;
            "kind"?: null | "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
            "status"?: null | "in_progress" | "completed" | "failed" | "pending";
            "title"?: null | string;
            "name"?: null | string;
            "content"?: null | ({
                "content": {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "text": string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "text";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "data": string;
                    "mimeType": string;
                    "uri"?: null | string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "image";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "data": string;
                    "mimeType": string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "audio";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "description"?: null | string;
                    "mimeType"?: null | string;
                    "name": string;
                    "size"?: null | number;
                    "title"?: null | string;
                    "uri": string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "resource_link";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "resource": {
                        "mimeType"?: null | string;
                        "text": string;
                        "uri": string;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    } | {
                        "blob": string;
                        "mimeType"?: null | string;
                        "uri": string;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "resource";
                };
                "_meta"?: null | {
                    [key: string]: unknown;
                };
                "type": "content";
            } | {
                "path": string;
                "oldText"?: null | string;
                "newText": string;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
                "type": "diff";
            } | {
                "terminalId": string;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
                "type": "terminal";
            })[];
            "locations"?: null | ({
                "path": string;
                "line"?: null | number;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
            })[];
            "rawInput"?: unknown;
            "rawOutput"?: unknown;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "options": ({
            "optionId": string;
            "name": string;
            "kind": "allow_once" | "allow_always" | "reject_once" | "reject_always";
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[];
        "_meta"?: null | {
            [key: string]: unknown;
        };
        "permissionId": string;
    })[];
};
export type AgentSessionsGETIdFindingsResponse = ({
    "id": string;
    "session_id": string;
    "file": string;
    "line": number;
    "severity": "low" | "medium" | "high" | "critical";
    "message": string;
})[];
export type AgentSessionsPOSTIdActionResponse = C.AgentSession | {
    "session": C.AgentSession;
    "commands": ({
        "name": string;
        "description": string;
        "source": "plangent";
    })[];
    "queue": ({
        "id": string;
        "session_id": string;
        "content": string;
    })[];
    "streaming": null | {
        "text": string;
        "type": string;
    };
    "permissions": ({
        "sessionId": string;
        "toolCall": {
            "toolCallId": string;
            "kind"?: null | "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
            "status"?: null | "in_progress" | "completed" | "failed" | "pending";
            "title"?: null | string;
            "name"?: null | string;
            "content"?: null | ({
                "content": {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "text": string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "text";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "data": string;
                    "mimeType": string;
                    "uri"?: null | string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "image";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "data": string;
                    "mimeType": string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "audio";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "description"?: null | string;
                    "mimeType"?: null | string;
                    "name": string;
                    "size"?: null | number;
                    "title"?: null | string;
                    "uri": string;
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "resource_link";
                } | {
                    "annotations"?: null | {
                        "audience"?: null | ("assistant" | "user")[];
                        "lastModified"?: null | string;
                        "priority"?: null | number;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "resource": {
                        "mimeType"?: null | string;
                        "text": string;
                        "uri": string;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    } | {
                        "blob": string;
                        "mimeType"?: null | string;
                        "uri": string;
                        "_meta"?: null | {
                            [key: string]: unknown;
                        };
                    };
                    "_meta"?: null | {
                        [key: string]: unknown;
                    };
                    "type": "resource";
                };
                "_meta"?: null | {
                    [key: string]: unknown;
                };
                "type": "content";
            } | {
                "path": string;
                "oldText"?: null | string;
                "newText": string;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
                "type": "diff";
            } | {
                "terminalId": string;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
                "type": "terminal";
            })[];
            "locations"?: null | ({
                "path": string;
                "line"?: null | number;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
            })[];
            "rawInput"?: unknown;
            "rawOutput"?: unknown;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "options": ({
            "optionId": string;
            "name": string;
            "kind": "allow_once" | "allow_always" | "reject_once" | "reject_always";
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[];
        "_meta"?: null | {
            [key: string]: unknown;
        };
        "permissionId": string;
    })[];
};
export type AgentSessionsPOSTIdActionBody = {
    "gitForTurn"?: boolean;
    "content"?: ({
        "annotations"?: null | {
            "audience"?: null | ("assistant" | "user")[];
            "lastModified"?: null | string;
            "priority"?: null | number;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "text": string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
        "type": "text";
    } | {
        "annotations"?: null | {
            "audience"?: null | ("assistant" | "user")[];
            "lastModified"?: null | string;
            "priority"?: null | number;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "data": string;
        "mimeType": string;
        "uri"?: null | string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
        "type": "image";
    } | {
        "annotations"?: null | {
            "audience"?: null | ("assistant" | "user")[];
            "lastModified"?: null | string;
            "priority"?: null | number;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "data": string;
        "mimeType": string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
        "type": "audio";
    } | {
        "annotations"?: null | {
            "audience"?: null | ("assistant" | "user")[];
            "lastModified"?: null | string;
            "priority"?: null | number;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "description"?: null | string;
        "mimeType"?: null | string;
        "name": string;
        "size"?: null | number;
        "title"?: null | string;
        "uri": string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
        "type": "resource_link";
    } | {
        "annotations"?: null | {
            "audience"?: null | ("assistant" | "user")[];
            "lastModified"?: null | string;
            "priority"?: null | number;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "resource": {
            "mimeType"?: null | string;
            "text": string;
            "uri": string;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        } | {
            "blob": string;
            "mimeType"?: null | string;
            "uri": string;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        };
        "_meta"?: null | {
            [key: string]: unknown;
        };
        "type": "resource";
    })[];
    "text"?: string;
    "permissionId"?: string;
    "optionId"?: string;
    "model"?: string;
    "mode"?: string;
    "configId"?: string;
    "value"?: string;
};
export type AgentSessionsPATCHIdBody = {
    title?: string;
    policy?: C.PermissionPolicy;
};
export type AgentSessionsPATCHIdQueuePromptIdResponse = {
    "ok": boolean;
};
export type AgentSessionsPATCHIdQueuePromptIdBody = {
    text: string;
};
export interface AgentSessionsEndpoints {
    "GET /api/agent-sessions": Endpoint<"GET /api/agent-sessions", never, (C.AgentSession)[], {
        "projectId"?: string;
    }, "json", never>;
    "POST /api/agent-sessions": Endpoint<"POST /api/agent-sessions", AgentSessionsPOSTBody, C.AgentSession, Record<string, never>, "json", never>;
    "GET /api/agent-sessions/:id": Endpoint<"GET /api/agent-sessions/:id", never, AgentSessionsGETIdResponse, Record<string, never>, "json", never>;
    "GET /api/agent-sessions/:id/findings": Endpoint<"GET /api/agent-sessions/:id/findings", never, AgentSessionsGETIdFindingsResponse, Record<string, never>, "json", never>;
    "POST /api/agent-sessions/:id/:action": Endpoint<"POST /api/agent-sessions/:id/:action", AgentSessionsPOSTIdActionBody, AgentSessionsPOSTIdActionResponse, Record<string, never>, "json", never>;
    "DELETE /api/agent-sessions/:id": Endpoint<"DELETE /api/agent-sessions/:id", never, void, Record<string, never>, "empty", never>;
    "PATCH /api/agent-sessions/:id": Endpoint<"PATCH /api/agent-sessions/:id", AgentSessionsPATCHIdBody, C.AgentSession, Record<string, never>, "json", never>;
    "PATCH /api/agent-sessions/:id/queue/:promptId": Endpoint<"PATCH /api/agent-sessions/:id/queue/:promptId", AgentSessionsPATCHIdQueuePromptIdBody, AgentSessionsPATCHIdQueuePromptIdResponse, Record<string, never>, "json", never>;
    "DELETE /api/agent-sessions/:id/queue/:promptId": Endpoint<"DELETE /api/agent-sessions/:id/queue/:promptId", never, void, Record<string, never>, "empty", never>;
}
