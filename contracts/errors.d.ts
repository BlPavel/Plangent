import type { JsonValue } from './endpoint';
export interface ApiError {
    error: string;
    detail?: string;
    code?: string;
    output?: string;
    blockers?: {
        files: string[];
        commits: string[];
    };
    confirmation_required?: boolean;
    /** Set with `code: "agent_cli_missing"`: what the client may offer to install. */
    install?: import('./agents').AgentCliInstall | null;
    references?: import('./tasks').PlanStep[];
}
