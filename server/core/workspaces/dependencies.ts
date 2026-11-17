// Supplied by the application composition root. Type imports do not load services.
import type * as review from '../review';

export const moduleDependencies = {} as {
  review: typeof review;
  /** Terminals keep their folder open: Windows cannot delete a folder a process works in. */
  closeTerminals?: (workspaceId: string) => Promise<void>;
};

export function configureDependencies(dependencies: Partial<typeof moduleDependencies>): void {
  Object.assign(moduleDependencies, dependencies);
}
