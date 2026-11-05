// Supplied by the application composition root. Type imports do not load services.
import type * as projects from '../projects';

export const moduleDependencies = {} as {
  projects: Pick<typeof projects, 'getProject' | 'ProjectError'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
