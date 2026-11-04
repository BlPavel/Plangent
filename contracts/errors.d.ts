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
    references?: import('./tasks').PlanStep[];
}
