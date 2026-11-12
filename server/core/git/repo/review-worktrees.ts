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
export async function removeReviewWorktrees(root: string, reviewId: string): Promise<void> {
  for (const worktree of activeReviewWorktrees(reviewId)) {
    restoreReviewLibrary(worktree.path);
    // Git removes only registered worktrees; never delete a computed path ourselves.
    await runGit(root, ['worktree', 'remove', worktree.path]);
    deactivateReviewWorktree(reviewId, worktree.head);
  }
}
export function reviewWorkspace(sessionId: string): string {
  const location = findReviewWorkspace(sessionId);
  if (!location) throw new DomainError('Private MR review: discussion only, read-only; no publication or drafting GitLab comments', 409);
  return location;
}
