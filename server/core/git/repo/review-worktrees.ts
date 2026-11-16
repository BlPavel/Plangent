import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { runGit } from '../../../infrastructure/git/write';
import { hasReviewWorktree, registerReviewWorktree, activeReviewWorktrees, deactivateReviewWorktree, findReviewWorkspace } from '../../../infrastructure/db/repositories/git/review-worktrees';
import { restoreReviewLibrary } from '../../library';
import { DomainError } from '../../../models/domain-error';

/** Caller serializes the complete workflow, including session creation or closure. */
export async function ensureReviewWorktree(root: string, reviewId: string, head: string): Promise<string> {
  const location = path.join(os.tmpdir(), 'plangent-reviews', reviewId, head);
  if (!hasReviewWorktree(reviewId, head)) {
    await fs.mkdir(path.dirname(location), { recursive: true });
    await runGit(root, ['worktree', 'add', '--detach', location, head]);
    registerReviewWorktree(reviewId, head, location);
  }
  return location;
}
const reviewsRoot = () => path.join(os.tmpdir(), 'plangent-reviews');
/** The worktree is a disposable checkout: local changes (the installed instructions, files the agent left) must not block removing it. */
async function removeWorktree(root: string, location: string): Promise<void> {
  try {
    await runGit(root, ['worktree', 'remove', '--force', '--force', location]);
  } catch (error) {
    // A process still holds the folder (Windows) or it is half gone: delete it ourselves, but only inside our own folder.
    const inside = path.relative(reviewsRoot(), location);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw error;
    await fs.rm(location, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await runGit(root, ['worktree', 'prune']);
  }
}
/** One worktree failing does not stop the others; the first failure is thrown afterwards. */
export async function removeReviewWorktrees(root: string, reviewId: string): Promise<void> {
  let failure: unknown;
  for (const worktree of activeReviewWorktrees(reviewId)) {
    try {
      restoreReviewLibrary(worktree.path);
      await removeWorktree(root, worktree.path);
      deactivateReviewWorktree(reviewId, worktree.head);
    } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}
export function reviewWorkspace(sessionId: string): string {
  const location = findReviewWorkspace(sessionId);
  if (!location) throw new DomainError('Private MR review: discussion only, read-only; no publication or drafting GitLab comments', 409);
  return location;
}
