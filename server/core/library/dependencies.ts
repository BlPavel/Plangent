// Supplied by the application composition root. Type imports do not load services.
import type * as agents from '../agents';
import type * as preparation from '../preparation';
import type * as workspaces from '../workspaces';

export const moduleDependencies = {} as {
  agents: Pick<typeof agents, 'getSession' | 'listAgents'>;
  preparation: Pick<typeof preparation, 'MATERIAL_KINDS'>;
  workspaces: Pick<typeof workspaces, 'listWorkspaces'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
