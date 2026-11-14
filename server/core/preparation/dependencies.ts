// Supplied by the application composition root. Type imports do not load services.
import type * as execution from '../execution';

export const moduleDependencies = {} as {
  execution: Pick<typeof execution, 'getQueue' | 'remapQueuePoints' | 'repairMojibake'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
