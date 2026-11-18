/** ACP options as exposed to the composer, supporting both current and older adapters. */
export interface AgentOptionsSource {
    commands?: { name: string; description: string }[];
    configOptions?: RawConfigOption[] | null;
    modes?: { currentModeId?: string; availableModes: { id: string; name: string; description?: string | null }[] } | null;
    models?: { currentModelId?: string; availableModels: { modelId: string; name: string; description?: string | null }[] } | null;
}
export interface RawChoice { value: string; name: string; description?: string | null; options?: RawChoice[] }
export interface RawConfigOption { id: string; name?: string; category?: string | null; type?: string; currentValue?: string | boolean; options?: (RawChoice | { name: string; options: RawChoice[] })[] }
export interface LayoutSlot {
    dir: string;
    global: string;
    file: string;
    asSkill?: boolean;
    asMerged?: boolean;
}
export interface LayoutProfile {
    skills?: LayoutSlot;
    commands?: LayoutSlot;
    main?: {
        file: string;
        global: string;
    };
}
export interface Agent {
    id: string;
    name: string;
    // ACP adapter process; empty for the seeded agents, which fall back to their preset (core/agents/presets).
    acp_command: string;
    acp_args: string[];
    env: Record<string, string>;
    // Plain CLI: used to read usage limits; update_command updates it.
    command: string;
    update_command: string;
    // Where the library syncer writes instructions/skills for this agent.
    layout_profile: LayoutProfile | null;
    // Defaults for new sessions, as values the agent itself reported (see agents/acp-options).
    model: string;
    reasoning_effort: string;
    active: boolean;
    created_at: string;
}
export interface AgentPreset {
    name: string;
    acp_command: string;
    acp_args: string[];
    env?: Record<string, string>;
    command: string;
    update_command: string;
    layout_profile: LayoutProfile | null;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type AgentsGETPresetsResponse = Record<string, AgentPreset>;
export type AgentsGETIdLimitsResponse = {
    "agentId": string;
    "at": number;
    "windows": ({
        "id": string;
        "label": string;
        "percent": number;
        "resetsAt": null | number;
    })[];
    "error"?: string;
};
export type AgentsGETIdAcpOptionsResponse = (Exclude<AgentAcpOptionsResponse, null> & { commands?: { name: string; description: string }[] }) | null;
type AgentAcpOptionsResponse = null | {
    "configOptions"?: null | ({
        "currentValue": string;
        "options": ({
            "value": string;
            "name": string;
            "description"?: null | string;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[] | ({
            "group": string;
            "name": string;
            "options": ({
                "value": string;
                "name": string;
                "description"?: null | string;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
            })[];
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[];
        "type": "select";
        "id": string;
        "name": string;
        "description"?: null | string;
        "category"?: null | string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
    } | {
        "currentValue": boolean;
        "type": "boolean";
        "id": string;
        "name": string;
        "description"?: null | string;
        "category"?: null | string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
    })[];
    "modes"?: null | {
        "currentModeId": string;
        "availableModes": ({
            "id": string;
            "name": string;
            "description"?: null | string;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[];
        "_meta"?: null | {
            [key: string]: unknown;
        };
    };
    "models"?: unknown;
    "agent"?: null | {
        "name"?: string;
        "title"?: null | string;
        "version"?: string;
    };
    "capabilities"?: null | {
        "loadSession": boolean;
        "mcpHttp": boolean;
    };
    "launch"?: string;
    "at": number;
} | {
    "configOptions"?: null | ({
        "currentValue": string;
        "options": ({
            "value": string;
            "name": string;
            "description"?: null | string;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[] | ({
            "group": string;
            "name": string;
            "options": ({
                "value": string;
                "name": string;
                "description"?: null | string;
                "_meta"?: null | {
                    [key: string]: unknown;
                };
            })[];
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[];
        "type": "select";
        "id": string;
        "name": string;
        "description"?: null | string;
        "category"?: null | string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
    } | {
        "currentValue": boolean;
        "type": "boolean";
        "id": string;
        "name": string;
        "description"?: null | string;
        "category"?: null | string;
        "_meta"?: null | {
            [key: string]: unknown;
        };
    })[];
    "modes"?: null | {
        "currentModeId": string;
        "availableModes": ({
            "id": string;
            "name": string;
            "description"?: null | string;
            "_meta"?: null | {
                [key: string]: unknown;
            };
        })[];
        "_meta"?: null | {
            [key: string]: unknown;
        };
    };
    "models"?: unknown;
    "agent"?: null | {
        "name"?: string;
        "title"?: null | string;
        "version"?: string;
    };
    "capabilities"?: null | {
        "loadSession": boolean;
        "mcpHttp": boolean;
    };
    "launch"?: string;
    "at": number;
};
export type AgentsPOSTBody = Partial<C.Agent> & {
    name: string;
};
export type AgentsPATCHIdBody = Partial<C.Agent>;
export type AgentsPOSTIdUpdateResponse = {
    "cli": null | {
        "ok": true;
        "output": string;
    } | {
        "ok": false;
        "error": string;
    };
    "adapter": null | {
        "ok": true;
        "package": string;
        "from": string;
        "to": string;
    } | {
        "ok": false;
        "package": string;
        "error": string;
    };
};
export interface AgentsEndpoints {
    "GET /api/agents": Endpoint<"GET /api/agents", never, (C.Agent)[], Record<string, never>, "json", never>;
    "GET /api/agents/presets": Endpoint<"GET /api/agents/presets", never, AgentsGETPresetsResponse, Record<string, never>, "json", never>;
    "GET /api/agents/:id": Endpoint<"GET /api/agents/:id", never, C.Agent, Record<string, never>, "json", never>;
    "GET /api/agents/:id/limits": Endpoint<"GET /api/agents/:id/limits", never, AgentsGETIdLimitsResponse, {
        "refresh"?: string;
    }, "json", never>;
    "GET /api/agents/:id/acp-options": Endpoint<"GET /api/agents/:id/acp-options", never, AgentsGETIdAcpOptionsResponse, {
        "cached"?: string;
        "refresh"?: string;
    }, "json", never>;
    "POST /api/agents": Endpoint<"POST /api/agents", AgentsPOSTBody, C.Agent, Record<string, never>, "json", never>;
    "PATCH /api/agents/:id": Endpoint<"PATCH /api/agents/:id", AgentsPATCHIdBody, C.Agent, Record<string, never>, "json", never>;
    "POST /api/agents/:id/update": Endpoint<"POST /api/agents/:id/update", never, AgentsPOSTIdUpdateResponse, Record<string, never>, "json", never>;
    "DELETE /api/agents/:id": Endpoint<"DELETE /api/agents/:id", never, void, Record<string, never>, "empty", never>;
}
