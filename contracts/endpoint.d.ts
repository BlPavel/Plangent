export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue | undefined;
};
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ResponseKind = 'json' | 'empty' | 'ndjson' | 'file';
export type PathParams<Path extends string> = Path extends `${string}:${infer Param}/${infer Tail}` ? {
    [K in Param | keyof PathParams<Tail>]: string;
} : Path extends `${string}:${infer Param}` ? {
    [K in Param]: string;
} : Record<string, never>;
/** Key includes the method and full mounted path. */
export interface Endpoint<Key extends `${HttpMethod} ${string}`, Body, Reply, Query = Record<string, never>, Kind extends ResponseKind = 'json', Event = never> {
    key: Key;
    params: Key extends `${HttpMethod} ${infer Path}` ? PathParams<Path> : never;
    query: Query;
    body: Body;
    response: Reply;
    error: import('./errors').ApiError;
    kind: Kind;
    event: Event;
}
import type { TerminalsEndpoints, TaskMrEndpoints, PlanReviewEndpoints, BranchReviewEndpoints, IntegrationsEndpoints, AgentSessionsEndpoints, CodeEndpoints, GitEndpoints, FinishEndpoints, CodeReviewsEndpoints, ProjectsEndpoints, TasksEndpoints, WorkEndpoints, LibraryEndpoints, AgentsEndpoints, FilesEndpoints, SettingsEndpoints, QueueEndpoints } from "./index";
export interface Endpoints extends TerminalsEndpoints, TaskMrEndpoints, PlanReviewEndpoints, BranchReviewEndpoints, IntegrationsEndpoints, AgentSessionsEndpoints, CodeEndpoints, GitEndpoints, FinishEndpoints, CodeReviewsEndpoints, ProjectsEndpoints, TasksEndpoints, WorkEndpoints, LibraryEndpoints, AgentsEndpoints, FilesEndpoints, SettingsEndpoints, QueueEndpoints {
}
export type EndpointKey = keyof Endpoints;

