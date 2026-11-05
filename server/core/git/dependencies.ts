// Supplied by the application composition root. Type imports do not load services.
import type * as preparation from '../preparation';

export const moduleDependencies = {} as {
  preparation: Pick<typeof preparation, 'analysisToolContext'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
