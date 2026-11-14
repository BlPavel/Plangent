import type * as Contract from '@contracts';
export type * from '@contracts';
export type Plan = Omit<Contract.Plan, 'steps'>;
export type AnalysisSection = Omit<Contract.AnalysisSection, 'files'>;
export interface PlanFrontmatter {
  plangent?: number;
  key?: string;
  title?: string;
  status?: 'open' | 'in_progress' | 'done';
}

export type AnalysisFile = Contract.AnalysisFile & { content: Buffer };
