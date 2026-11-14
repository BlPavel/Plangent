export interface Terminal {
    id: string;
    projectId: string;
    title: string;
    shell: string;
    cwd: string;
    workspaceId: string | null;
    exitCode?: number;
    status?: 'running' | 'exited';
}
export interface TerminalShell {
    id: string;
    label: string;
}
export interface RunningTerminal {
    id: string;
    title: string;
    workspaceId: string | null;
    processes: {
        pid: number;
        name: string;
    }[];
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type TerminalsGETShellsResponse = ({
    "id": string;
    "label": string;
})[];
export type TerminalsGETRunningResponse = ({
    "id": string;
    "title": string;
    "workspaceId": null | string;
    "processes": ({
        "pid": number;
        "name": string;
    })[];
})[];
export type TerminalsPOSTBody = {
    projectId: string;
    workspaceId?: string | null;
    workspace?: string | null;
    shell?: string;
};
export type TerminalsPATCHIdBody = {
    title?: string;
};
export type TerminalsPOSTIdActionResponse = {
    "id": string;
    "projectId": string;
    "title": string;
    "shell": string;
    "cwd": string;
    "workspaceId": null | string;
};
export interface TerminalsEndpoints {
    "GET /api/terminals/shells": Endpoint<"GET /api/terminals/shells", never, TerminalsGETShellsResponse, Record<string, never>, "json", never>;
    "GET /api/terminals": Endpoint<"GET /api/terminals", never, C.Terminal[], {
        "projectId"?: string;
        "workspace"?: string;
    }, "json", never>;
    "GET /api/terminals/running": Endpoint<"GET /api/terminals/running", never, TerminalsGETRunningResponse, {
        "projectId"?: string;
    }, "json", never>;
    "POST /api/terminals": Endpoint<"POST /api/terminals", TerminalsPOSTBody, C.Terminal, Record<string, never>, "json", never>;
    "PATCH /api/terminals/:id": Endpoint<"PATCH /api/terminals/:id", TerminalsPATCHIdBody, C.Terminal, Record<string, never>, "json", never>;
    "POST /api/terminals/:id/:action": Endpoint<"POST /api/terminals/:id/:action", never, TerminalsPOSTIdActionResponse, Record<string, never>, "json", never>;
    "DELETE /api/terminals/:id": Endpoint<"DELETE /api/terminals/:id", never, void, Record<string, never>, "empty", never>;
}
