// Supplied by the application composition root. Type imports do not load services.
import type * as work from '../work';

export const moduleDependencies = {} as {
  work: Pick<typeof work, 'withWorkStart'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
