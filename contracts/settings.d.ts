export interface Setting {
    key: string;
    value: JsonValue;
    updated_at?: string;
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
    "GET /api/settings/:key": Endpoint<"GET /api/settings/:key", never, SettingsGETKeyResponse, Record<string, never>, "json", never>;
    "PUT /api/settings/:key": Endpoint<"PUT /api/settings/:key", SettingsPUTKeyBody, SettingsPUTKeyResponse, Record<string, never>, "json", never>;
    "GET /api/health": Endpoint<"GET /api/health", never, ServerGETApiHealthResponse, Record<string, never>, "json", never>;
    "GET *": Endpoint<"GET *", never, void, Record<string, never>, "file", never>;
}
