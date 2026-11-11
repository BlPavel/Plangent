// Supplied by the application composition root. Type imports do not load services.
import type * as preparation from '../preparation';
import type * as tasks from '../tasks';
import type * as workspaces from '../workspaces';

export const moduleDependencies = {} as {
  preparation: Pick<typeof preparation, 'buildLibrarianPrompt' | 'listAnalysisSections'>;
  tasks: Pick<typeof tasks, 'getTask'>;
  workspaces: Pick<typeof workspaces, 'rootForSession' | 'writableRootsForSession' | 'assertTaskWorkspaceReady' | 'envForSession'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
