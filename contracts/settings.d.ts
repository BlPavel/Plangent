export interface Setting {
    key: string;
    value: JsonValue;
    updated_at?: string;
}
/** Credentials are write-only; GET never returns the password. */
export interface AgentProxySettings {
    url: string;
    username: string;
    hasPassword: boolean;
    /** Optional PEM certificate authorities for the HTTPS proxy connection. */
    ca?: string;
}
export interface AgentProxyInput {
    url: string;
    username?: string;
    /** Omit to keep the saved password; an empty string removes it. */
    password?: string;
    ca?: string;
}
export interface AgentProxyCheck {
    ok: boolean;
    results: { host: string; ok: boolean; error?: string }[];
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type SettingsGETKeyResponse = {
    "value": string;
    "updated_at": null | string;
};
export type SettingsPUTKeyResponse = {
    "ok": boolean;
};
export type SettingsPUTKeyBody = {
    "value"?: string;
};
export type ServerGETApiHealthResponse = {
    "ok": boolean;
    "version": string;
};
export interface SettingsEndpoints {
    "GET /api/settings/agent-proxy": Endpoint<"GET /api/settings/agent-proxy", never, AgentProxySettings, Record<string, never>, "json", never>;
    "PUT /api/settings/agent-proxy": Endpoint<"PUT /api/settings/agent-proxy", AgentProxyInput, AgentProxySettings, Record<string, never>, "json", never>;
    "POST /api/settings/agent-proxy/check": Endpoint<"POST /api/settings/agent-proxy/check", never, AgentProxyCheck, Record<string, never>, "json", never>;
    "GET /api/settings/:key": Endpoint<"GET /api/settings/:key", never, SettingsGETKeyResponse, Record<string, never>, "json", never>;
    "PUT /api/settings/:key": Endpoint<"PUT /api/settings/:key", SettingsPUTKeyBody, SettingsPUTKeyResponse, Record<string, never>, "json", never>;
    "GET /api/health": Endpoint<"GET /api/health", never, ServerGETApiHealthResponse, Record<string, never>, "json", never>;
    "GET *": Endpoint<"GET *", never, void, Record<string, never>, "file", never>;
}
