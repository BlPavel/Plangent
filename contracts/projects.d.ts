import type { SourceType, SyncStatus, DocsSelection, SyncStats, FinishScenario } from './index';
export interface ProjectConfig {
    dangerous_commands?: string[];
    extra_env?: Record<string, string>;
    // Sources only: how the folder gets its files; just 'folder' for now (see docs/DOCS-PROPOSAL.md).
    source_type?: SourceType;
}
export type ProjectKind = 'project' | 'group' | 'source';
export interface ProjectGitSettings {
    auto_review?: boolean;
    git_agent_id?: string;
    git_agent_model?: string;
    git_agent_effort?: string;
    review_agent_id?: string;
    review_agent_model?: string;
    review_agent_effort?: string;
    conflict_agent_id?: string;
    conflict_agent_model?: string;
    conflict_agent_effort?: string;
    workspace_copy_files?: string[];
    workspace_setup_command?: string;
    commit_pattern?: string;
    forbidden_patterns?: string[];
    include_description?: boolean;
    finish_scenario?: FinishScenario;
    branch_prefixes?: string[];
    base_branch?: string;
    mr_description_prompt?: string;
    mr_remove_branch?: boolean;
    mr_squash?: boolean;
    mr_reviewers?: string[];
    mr_assignees?: string[];
}
export type GitSettings = Required<ProjectGitSettings>;
export interface Project {
    active_tasks?: number;
    id: string;
    kind: ProjectKind;
    name: string;
    // @-key of projects and sources, unique across both; null for groups.
    key: string | null;
    clone_url?: string;
    host_project_path?: string;
    git_settings?: ProjectGitSettings;
    repo_path: string;
    group_id: string | null;
    icon: string;
    // What the agent is told about a source (or a group's purpose).
    description: string;
    default_agent_id: string | null;
    config: ProjectConfig;
    hide_from_git: boolean;
    created_at: string;
    source_type: SourceType;
    connection_id: string | null;
    docs_config: Record<string, unknown>;
    docs_selection: DocsSelection[];
    sync_status: SyncStatus;
    last_sync_at: string | null;
    sync_stats: SyncStats;
}
// HTTP endpoint map: full mounted paths, including the /api prefix.
import type * as C from "./index";
import type { Endpoint, JsonValue } from "./endpoint";
export type ProjectsGETResponse = (C.Project & { active_tasks: number })[];
export type ProjectsPOSTGitPreviewResponse = {
    "repository": boolean;
    "clone_url": string;
    "host_project_path": string;
    "connection_id": null | string;
};
export type ProjectsPOSTGitPreviewBody = {
    "repo_path"?: string;
};
export type ProjectsGETGitDefaultsResponse = {
    "own": {
        "commit_pattern"?: string;
        "workspace_copy_files"?: (string)[];
        "workspace_setup_command"?: string;
        "auto_review"?: false | true;
        "forbidden_patterns"?: (string)[];
        "include_description"?: false | true;
        "finish_scenario"?: "push" | "nothing" | "commits" | "full";
        "branch_prefixes"?: (string)[];
        "base_branch"?: string;
        "mr_description_prompt"?: string;
        "mr_remove_branch"?: false | true;
        "mr_squash"?: false | true;
        "mr_reviewers"?: (string)[];
        "mr_assignees"?: (string)[];
        "git_agent_id"?: string;
        "git_agent_model"?: string;
        "git_agent_effort"?: string;
        "review_agent_id"?: string;
        "review_agent_model"?: string;
        "review_agent_effort"?: string;
        "conflict_agent_id"?: string;
        "conflict_agent_model"?: string;
        "conflict_agent_effort"?: string;
    };
    "values": {
        "commit_pattern": string;
        "workspace_copy_files": (string)[];
        "workspace_setup_command": string;
        "auto_review": boolean;
        "forbidden_patterns": (string)[];
        "include_description": boolean;
        "finish_scenario": "push" | "nothing" | "commits" | "full";
        "branch_prefixes": (string)[];
        "base_branch": string;
        "mr_description_prompt": string;
        "mr_remove_branch": boolean;
        "mr_squash": boolean;
        "mr_reviewers": (string)[];
        "mr_assignees": (string)[];
        "git_agent_id": string;
        "git_agent_model": string;
        "git_agent_effort": string;
        "review_agent_id": string;
        "review_agent_model": string;
        "review_agent_effort": string;
        "conflict_agent_id": string;
        "conflict_agent_model": string;
        "conflict_agent_effort": string;
    };
    "sources": {
        [key: string]: string;
    };
};
export type ProjectsGETIdGitSettingsResponse = {
    "values": {
        "commit_pattern": string;
        "workspace_copy_files": (string)[];
        "workspace_setup_command": string;
        "auto_review": boolean;
        "forbidden_patterns": (string)[];
        "include_description": boolean;
        "finish_scenario": "push" | "nothing" | "commits" | "full";
        "branch_prefixes": (string)[];
        "base_branch": string;
        "mr_description_prompt": string;
        "mr_remove_branch": boolean;
        "mr_squash": boolean;
        "mr_reviewers": (string)[];
        "mr_assignees": (string)[];
        "git_agent_id": string;
        "git_agent_model": string;
        "git_agent_effort": string;
        "review_agent_id": string;
        "review_agent_model": string;
        "review_agent_effort": string;
        "conflict_agent_id": string;
        "conflict_agent_model": string;
        "conflict_agent_effort": string;
    };
    "sources": {
        [key: string]: string;
    };
};
export type ProjectsGETIdFilesResponse = ({
    "path": string;
    "dir": boolean;
    "uri": string;
})[];
export type ProjectsGETIdMentionsResponse = ({
    "path": string;
    "dir": boolean;
    "uri": string;
})[] | ({
    "path": string;
    "dir": boolean;
    "uri": string;
    "ref"?: false | true;
    "section"?: "members" | "sources" | "projects";
    "detail"?: string;
})[];
export type ProjectsPOSTCloneCancelBody = {
    "operationId"?: string;
};
export type ProjectsPOSTBody = {
    creation_mode?: "folder" | "clone";
    operationId?: string;
    reuse_existing?: boolean;
    "kind"?: "project" | "group" | "source";
    "name": string;
    "key"?: null | string;
    "repo_path"?: string;
    "group_id"?: null | string;
    "icon"?: string;
    "description"?: string;
    "default_agent_id"?: null | string;
    "config"?: C.ProjectConfig;
    "hide_from_git"?: false | true;
    "clone_url"?: string;
    "host_project_path"?: string;
    "git_settings"?: {
        "commit_pattern"?: string;
        "workspace_copy_files"?: (string)[];
        "workspace_setup_command"?: string;
        "auto_review"?: false | true;
        "forbidden_patterns"?: (string)[];
        "include_description"?: false | true;
        "finish_scenario"?: "push" | "nothing" | "commits" | "full";
        "branch_prefixes"?: (string)[];
        "base_branch"?: string;
        "mr_description_prompt"?: string;
        "mr_remove_branch"?: false | true;
        "mr_squash"?: false | true;
        "mr_reviewers"?: (string)[];
        "mr_assignees"?: (string)[];
        "git_agent_id"?: string;
        "git_agent_model"?: string;
        "git_agent_effort"?: string;
        "review_agent_id"?: string;
        "review_agent_model"?: string;
        "review_agent_effort"?: string;
        "conflict_agent_id"?: string;
        "conflict_agent_model"?: string;
        "conflict_agent_effort"?: string;
    };
    "source_type"?: "folder" | "docs";
    "connection_id"?: null | string;
    "docs_config"?: {
        [key: string]: unknown;
    };
    "docs_selection"?: (C.DocsSelection)[];
};
export type ProjectsPATCHIdBody = {
    "kind"?: "project" | "group" | "source";
    "name"?: string;
    "key"?: null | string;
    "repo_path"?: string;
    "group_id"?: null | string;
    "icon"?: string;
    "description"?: string;
    "default_agent_id"?: null | string;
    "config"?: C.ProjectConfig;
    "hide_from_git"?: false | true;
    "clone_url"?: string;
    "host_project_path"?: string;
    "git_settings"?: {
        "commit_pattern"?: string;
        "workspace_copy_files"?: (string)[];
        "workspace_setup_command"?: string;
        "auto_review"?: false | true;
        "forbidden_patterns"?: (string)[];
        "include_description"?: false | true;
        "finish_scenario"?: "push" | "nothing" | "commits" | "full";
        "branch_prefixes"?: (string)[];
        "base_branch"?: string;
        "mr_description_prompt"?: string;
        "mr_remove_branch"?: false | true;
        "mr_squash"?: false | true;
        "mr_reviewers"?: (string)[];
        "mr_assignees"?: (string)[];
        "git_agent_id"?: string;
        "git_agent_model"?: string;
        "git_agent_effort"?: string;
        "review_agent_id"?: string;
        "review_agent_model"?: string;
        "review_agent_effort"?: string;
        "conflict_agent_id"?: string;
        "conflict_agent_model"?: string;
        "conflict_agent_effort"?: string;
    };
    "source_type"?: "folder" | "docs";
    "connection_id"?: null | string;
    "docs_config"?: {
        [key: string]: unknown;
    };
    "docs_selection"?: (C.DocsSelection)[];
};
export interface ProjectsEndpoints {
    "GET /api/projects": Endpoint<"GET /api/projects", never, ProjectsGETResponse, Record<string, never>, "json", never>;
    "POST /api/projects/git-preview": Endpoint<"POST /api/projects/git-preview", ProjectsPOSTGitPreviewBody, ProjectsPOSTGitPreviewResponse, Record<string, never>, "json", never>;
    "GET /api/projects/git-defaults": Endpoint<"GET /api/projects/git-defaults", never, ProjectsGETGitDefaultsResponse, Record<string, never>, "json", never>;
    "PUT /api/projects/git-defaults": Endpoint<"PUT /api/projects/git-defaults", C.ProjectGitSettings, ProjectsGETGitDefaultsResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:id": Endpoint<"GET /api/projects/:id", never, C.Project, Record<string, never>, "json", never>;
    "GET /api/projects/:id/host-members": Endpoint<"GET /api/projects/:id/host-members", never, (C.HostMember)[], Record<string, never>, "json", never>;
    "GET /api/projects/:id/git-settings": Endpoint<"GET /api/projects/:id/git-settings", never, ProjectsGETIdGitSettingsResponse, Record<string, never>, "json", never>;
    "GET /api/projects/:id/files": Endpoint<"GET /api/projects/:id/files", never, ProjectsGETIdFilesResponse, {
        "q"?: string;
    }, "json", never>;
    "GET /api/projects/:id/mentions": Endpoint<"GET /api/projects/:id/mentions", never, ProjectsGETIdMentionsResponse, {
        "q"?: string;
    }, "json", never>;
    "POST /api/projects/clone-cancel": Endpoint<"POST /api/projects/clone-cancel", ProjectsPOSTCloneCancelBody, void, Record<string, never>, "empty", never>;
    "POST /api/projects": Endpoint<"POST /api/projects", ProjectsPOSTBody, C.Project, Record<string, never>, "json", never>;
    "PATCH /api/projects/:id": Endpoint<"PATCH /api/projects/:id", ProjectsPATCHIdBody, C.Project, Record<string, never>, "json", never>;
    "DELETE /api/projects/:id": Endpoint<"DELETE /api/projects/:id", never, void, Record<string, never>, "empty", never>;
}
