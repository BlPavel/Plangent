// Supplied by the application composition root. Type imports do not load services.
import type * as preparation from '../preparation';
import type * as work from '../work';

export const moduleDependencies = {} as {
  preparation: Pick<typeof preparation, 'analysisToolContext'>;
  /** A task's finish that went through closes its work, as the manual «Закрыть работу» does. */
  work?: Pick<typeof work, 'closeWork'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
