// Supplied by the application composition root. Type imports do not load services.
import type * as workspaces from '../workspaces';
import type * as preparation from '../preparation';
import type * as execution from '../execution';

export const moduleDependencies = {} as {
  workspaces: Pick<typeof workspaces, 'activeWorkspace' | 'removeWorkspace'>;
  preparation: Pick<typeof preparation, 'createAnalysisSection' | 'deletePlanFile' | 'getLatestPlan' | 'updatePlan' | 'createPlan' | 'materializePlanFile' | 'watchPlanFile' | 'materializeTaskAnalysis' | 'getLatestMaterial' | 'stopWatchPlanFile'>;
  execution: Pick<typeof execution, 'getQueue' | 'isFrozen' | 'saveQueue'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
