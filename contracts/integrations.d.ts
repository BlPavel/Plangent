export type AuthStrategy = 'basic' | 'form' | 'auto' | 'token' | 'browser' | 'api-login';
export type CredentialMode = 'inherit' | 'credential' | 'own';
export type CredentialStatus = 'ready' | 'needs_update';
export type ConnectionCheckStatus = 'unchecked' | 'ok' | 'error' | 'needs_update';
export type SourceType = 'folder' | 'docs';
export type SyncStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';
export interface IntegrationOrganization {
    id: string;
    name: string;
    credential_id: string | null;
    created_at: string;
    updated_at: string;
}
export interface IntegrationCredential {
    id: string;
    organization_id: string | null;
    name: string;
    username: string;
    hasSecret: boolean;
    status: CredentialStatus;
    revision: number;
    created_at: string;
    updated_at: string;
}
export interface IntegrationConnection {
    id: string;
    name: string;
    base_url: string;
    organization_id: string | null;
    code_host?: string | null;
    credential_mode: CredentialMode;
    credential_id: string | null;
    auth_strategy: AuthStrategy;
    auth_config: Record<string, unknown>;
    last_check_status: ConnectionCheckStatus;
    last_check_at: string | null;
    last_check_message: string;
    created_at: string;
    updated_at: string;
}
export interface DocsSelection {
    id: string;
    include_descendants: boolean;
    excluded_ids?: string[];
}
export interface SyncStats {
    message?: string;
    code?: string;
    confirmation_count?: number;
    warnings?: string[];
    errors?: number;
    found?: number;
    downloaded?: number;
    added?: number;
    updated?: number;
    deleted?: number;
}
export type Organization = IntegrationOrganization;
export type Credential = IntegrationCredential;
export type Connection = IntegrationConnection;
export interface ConnectionCheck {
    ok: boolean;
    status: string;
    message: string;
    url: string;
    user?: string;
    version?: string;
    token_expires_at?: string;
}
export interface SecretStorage {
    kind?: string;
    available: boolean;
    insecure_dev_storage: boolean;
}
export interface IntegrationPreset {
    id: string;
    name: string;
    description: string;
    auth_strategy: string;
    auth_config: Record<string, unknown>;
    code_host?: string;
}
export interface DocsPreset {
    id: string;
    name: string;
    description: string;
    config: Record<string, unknown>;
}
export interface DocsForm {
    connection_id: string;
    docs_config: Record<string, unknown>;
    docs_selection: DocsSelection[];
}
export interface DocsNode {
    id: string;
    title: string;
    url: string;
}
export interface DocsProbe {
    urls: string[];
    fields: Record<string, unknown>;
    missing: string[];
    preview: string;
    warnings: string[];
}
export interface SyncProgress {
    stage: 'discover' | 'download' | 'done';
    found: number;
    downloaded: number;
    processed?: number;
    total?: number;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type IntegrationsGETPresetsResponse = readonly ({
    "id": string;
    "name": string;
    "description": string;
    "auth_strategy": C.AuthStrategy;
    "auth_config": {
        "token_header"?: string;
        "token_prefix"?: string;
        "check_details"?: ({
            "path": string;
            "value_path": string;
            "result_key": "version" | "token_expires_at";
            "label": string;
        })[];
        "check_path": string;
        "user_path"?: string;
        "expect_json"?: false | true;
        "timeout_ms"?: number;
        "login_path"?: string;
        "username_field"?: string;
        "password_field"?: string;
        "fields"?: {
            [key: string]: string;
        };
        "headers"?: {
            [key: string]: string;
        };
        "strategies"?: ("basic" | "form")[];
        "invalid_password"?: {
            "statuses"?: (number)[];
            "redirect_path"?: string;
            "header"?: {
                "name": string;
                "value": string;
            };
            "html_instead_of_json"?: false | true;
        };
        "invalid_session"?: {
            "statuses"?: (number)[];
            "redirect_path"?: string;
            "header"?: {
                "name": string;
                "value": string;
            };
            "html_instead_of_json"?: false | true;
        };
    };
    "code_host"?: string;
})[];
export type IntegrationsGETStorageResponse = {
    "kind": "safe-storage" | "dev-file" | "in-memory";
    "available": boolean;
    "insecure_dev_storage": boolean;
};
export type IntegrationsPOSTNormalizeUrlResponse = {
    "suggestion": null | string;
    "base_url": string;
    "normalized": boolean;
};
export type IntegrationsPOSTNormalizeUrlBody = {
    base_url: string;
};
export type IntegrationsPOSTOrganizationsBody = {
    name: string;
    credential_id?: string | null;
};
export type IntegrationsPATCHOrganizationsIdBody = Partial<{
    name: string;
    credential_id?: string | null;
}>;
export type IntegrationsPOSTCredentialsBody = {
    name: string;
    username?: string;
    organization_id?: string | null;
    password?: string;
};
export type IntegrationsPATCHCredentialsIdBody = Partial<{
    name: string;
    username?: string;
    organization_id?: string | null;
    password?: string;
}>;
export type IntegrationsPUTCredentialsIdPasswordBody = {
    password: string;
};
export type IntegrationsPOSTConnectionsBody = {
    own_credential?: { username?: string };
    name: string;
    base_url: string;
    organization_id?: string | null;
    code_host?: string | null;
    credential_mode?: C.CredentialMode;
    credential_id?: string | null;
    auth_strategy?: C.AuthStrategy;
    auth_config?: Record<string, unknown>;
    username?: string;
    password?: string;
};
export type IntegrationsPATCHConnectionsIdBody = Partial<{
    own_credential?: { username?: string };
    name: string;
    base_url: string;
    organization_id?: string | null;
    code_host?: string | null;
    credential_mode?: C.CredentialMode;
    credential_id?: string | null;
    auth_strategy?: C.AuthStrategy;
    auth_config?: Record<string, unknown>;
    username?: string;
    password?: string;
}>;
export type IntegrationsPUTConnectionsIdPasswordBody = {
    password: string;
};
export type IntegrationsPOSTConnectionsIdCheckResponse = {
    "ok": boolean;
    "status": string;
    "message": string;
    "url": string;
    "user"?: string;
    "version"?: string;
    "token_expires_at"?: string;
};
export type DocsSourcesGETPresetsResponse = readonly ({
    "id": string;
    "name": string;
    "description": string;
    "config": {
        "document_endpoint": string;
        "metadata_endpoint"?: string;
        "document_path"?: string;
        "metadata_path"?: string;
        "children"?: {
            "endpoint": string;
            "items_path": string;
            "pagination"?: {
                "mode": "offset" | "next";
                "limit"?: number;
                "offset_parameter"?: string;
                "limit_parameter"?: string;
                "next_path"?: string;
                "total_path"?: string;
            };
        };
        "lookup"?: {
            "endpoint": string;
            "items_path": string;
            "pagination"?: {
                "mode": "offset" | "next";
                "limit"?: number;
                "offset_parameter"?: string;
                "limit_parameter"?: string;
                "next_path"?: string;
                "total_path"?: string;
            };
        };
        "fields": {
            "id": string;
            "title": string;
            "body": string;
            "version"?: string;
            "parent"?: string;
            "ancestors"?: string;
            "url"?: string;
            "updated"?: string;
            "space"?: string;
            "author"?: string;
        };
        "link_patterns": ({
            "pattern": string;
            "id_group"?: number;
            "title_group"?: number;
            "scope_group"?: number;
        })[];
        "internal_link_patterns"?: ({
            "pattern": string;
            "id_group"?: number;
            "title_group"?: number;
            "scope_group"?: number;
        })[];
        "original_url"?: string;
        "body_format": "html" | "markdown";
        "conversion_rules"?: ({
            "selector": string;
            "action": "code" | "callout" | "unwrap" | "skip" | "unknown";
            "content"?: {
                "selector"?: string;
                "attribute"?: string;
            };
            "parameter"?: {
                "selector"?: string;
                "attribute"?: string;
            };
            "label"?: string;
        })[];
    };
})[];
export type DocsSourcesPOSTResolveResponse = {
    "id": string;
    "title": string;
    "parent"?: string;
    "ancestors"?: (string)[];
    "version"?: string;
    "url": string;
    "updated"?: string;
    "space"?: string;
    "author"?: string;
    "body"?: string;
};
export type DocsSourcesPOSTResolveBody = {
    input: string;
    connection_id?: string;
    config?: Record<string, unknown>;
};
export type DocsSourcesGETChildrenResponse = ({
    "id": string;
    "title": string;
    "parent"?: string;
    "ancestors"?: (string)[];
    "version"?: string;
    "url": string;
    "updated"?: string;
    "space"?: string;
    "author"?: string;
    "body"?: string;
})[];
export type DocsSourcesPOSTChildrenBody = {
    id: string;
    connection_id?: string;
    config?: Record<string, unknown>;
};
export type DocsSourcesPOSTProbeResponse = {
    "urls": (string)[];
    "fields": {
        [key: string]: unknown;
    };
    "missing": (string)[];
    "preview": string;
    "warnings": (string)[];
};
export type DocsSourcesPOSTProbeBody = {
    input: string;
    connection_id?: string;
    config?: Record<string, unknown>;
};
export type DocsSourcesPOSTSyncResponse = {
    "status": string;
};
export type DocsSourcesPOSTSyncBody = {
    confirmed_large?: boolean;
};
export interface IntegrationsEndpoints {
    "GET /api/integrations/presets": Endpoint<"GET /api/integrations/presets", never, IntegrationsGETPresetsResponse, Record<string, never>, "json", never>;
    "GET /api/integrations/storage": Endpoint<"GET /api/integrations/storage", never, IntegrationsGETStorageResponse, Record<string, never>, "json", never>;
    "POST /api/integrations/normalize-url": Endpoint<"POST /api/integrations/normalize-url", IntegrationsPOSTNormalizeUrlBody, IntegrationsPOSTNormalizeUrlResponse, Record<string, never>, "json", never>;
    "GET /api/integrations/organizations": Endpoint<"GET /api/integrations/organizations", never, (C.IntegrationOrganization)[], Record<string, never>, "json", never>;
    "POST /api/integrations/organizations": Endpoint<"POST /api/integrations/organizations", IntegrationsPOSTOrganizationsBody, C.IntegrationOrganization, Record<string, never>, "json", never>;
    "GET /api/integrations/organizations/:id": Endpoint<"GET /api/integrations/organizations/:id", never, C.IntegrationOrganization, Record<string, never>, "json", never>;
    "PATCH /api/integrations/organizations/:id": Endpoint<"PATCH /api/integrations/organizations/:id", IntegrationsPATCHOrganizationsIdBody, C.IntegrationOrganization, Record<string, never>, "json", never>;
    "DELETE /api/integrations/organizations/:id": Endpoint<"DELETE /api/integrations/organizations/:id", never, void, Record<string, never>, "empty", never>;
    "GET /api/integrations/credentials": Endpoint<"GET /api/integrations/credentials", never, (C.IntegrationCredential)[], Record<string, never>, "json", never>;
    "POST /api/integrations/credentials": Endpoint<"POST /api/integrations/credentials", IntegrationsPOSTCredentialsBody, C.IntegrationCredential, Record<string, never>, "json", never>;
    "GET /api/integrations/credentials/:id": Endpoint<"GET /api/integrations/credentials/:id", never, C.IntegrationCredential, Record<string, never>, "json", never>;
    "PATCH /api/integrations/credentials/:id": Endpoint<"PATCH /api/integrations/credentials/:id", IntegrationsPATCHCredentialsIdBody, C.IntegrationCredential, Record<string, never>, "json", never>;
    "PUT /api/integrations/credentials/:id/password": Endpoint<"PUT /api/integrations/credentials/:id/password", IntegrationsPUTCredentialsIdPasswordBody, C.IntegrationCredential, Record<string, never>, "json", never>;
    "DELETE /api/integrations/credentials/:id": Endpoint<"DELETE /api/integrations/credentials/:id", never, void, Record<string, never>, "empty", never>;
    "GET /api/integrations/connections": Endpoint<"GET /api/integrations/connections", never, (C.IntegrationConnection)[], Record<string, never>, "json", never>;
    "POST /api/integrations/connections": Endpoint<"POST /api/integrations/connections", IntegrationsPOSTConnectionsBody, C.IntegrationConnection, Record<string, never>, "json", never>;
    "GET /api/integrations/connections/:id": Endpoint<"GET /api/integrations/connections/:id", never, C.IntegrationConnection, Record<string, never>, "json", never>;
    "PATCH /api/integrations/connections/:id": Endpoint<"PATCH /api/integrations/connections/:id", IntegrationsPATCHConnectionsIdBody, C.IntegrationConnection, Record<string, never>, "json", never>;
    "DELETE /api/integrations/connections/:id": Endpoint<"DELETE /api/integrations/connections/:id", never, void, Record<string, never>, "empty", never>;
    "GET /api/integrations/connections/:id/credential": Endpoint<"GET /api/integrations/connections/:id/credential", never, null | C.IntegrationCredential, Record<string, never>, "json", never>;
    "PUT /api/integrations/connections/:id/password": Endpoint<"PUT /api/integrations/connections/:id/password", IntegrationsPUTConnectionsIdPasswordBody, C.IntegrationCredential, Record<string, never>, "json", never>;
    "POST /api/integrations/connections/:id/check": Endpoint<"POST /api/integrations/connections/:id/check", never, IntegrationsPOSTConnectionsIdCheckResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:id/docs/presets": Endpoint<"GET /api/projects/:id/docs/presets", never, DocsSourcesGETPresetsResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:id/docs/resolve": Endpoint<"POST /api/projects/:id/docs/resolve", DocsSourcesPOSTResolveBody, DocsSourcesPOSTResolveResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:id/docs/children": Endpoint<"GET /api/projects/:id/docs/children", never, DocsSourcesGETChildrenResponse, {
        "id"?: string;
    }, "json", never>;
    "POST /api/projects/:id/docs/children": Endpoint<"POST /api/projects/:id/docs/children", DocsSourcesPOSTChildrenBody, DocsSourcesGETChildrenResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:id/docs/probe": Endpoint<"POST /api/projects/:id/docs/probe", DocsSourcesPOSTProbeBody, DocsSourcesPOSTProbeResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:id/docs/sync": Endpoint<"POST /api/projects/:id/docs/sync", DocsSourcesPOSTSyncBody, DocsSourcesPOSTSyncResponse, Record<string, never>, "json", never>;
    "POST /api/projects/:id/docs/cancel": Endpoint<"POST /api/projects/:id/docs/cancel", never, null | C.Project, Record<string, never>, "json", never>;
}


