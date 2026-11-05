// Supplied by the application composition root. Type imports do not load services.
import type * as review from '../review';

export const moduleDependencies = {} as {
  review: Pick<typeof review, 'launchTaskReview' | 'taskReviewCount'>;
};

export function configureDependencies(dependencies: typeof moduleDependencies): void {
  Object.assign(moduleDependencies, dependencies);
}
