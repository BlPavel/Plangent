export {};
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type BrowseGETResponse = {
    "path": string;
    "parent": null;
    "entries": ({
        "name": string;
        "path": string;
        "isDir": boolean;
    })[];
} | {
    "path": string;
    "parent": null | string;
    "entries": ({
        "name": string;
        "isDir": boolean;
    })[];
};
export type UploadPOSTResponse = {
    "path": string;
};
export type UploadPOSTBody = {
    "data"?: string;
    "name"?: string;
};
export type ClipboardGETPathsResponse = {
    "paths": (string)[];
} | {
    "paths": (never)[];
};
export interface FilesEndpoints {
    "GET /api/browse": Endpoint<"GET /api/browse", never, BrowseGETResponse, {
        "path"?: string;
    }, "json", never>;
    "POST /api/upload-temp": Endpoint<"POST /api/upload-temp", UploadPOSTBody, UploadPOSTResponse, Record<string, never>, "json", never>;
    "GET /api/clipboard/paths": Endpoint<"GET /api/clipboard/paths", never, ClipboardGETPathsResponse, Record<string, never>, "json", never>;
}
