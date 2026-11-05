import { getDb } from '../../schema';

export function hasReviewWorktree(reviewId: string, head: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM branch_review_worktrees WHERE review_id=? AND head=? AND active=1').get(reviewId, head);
}
export function registerReviewWorktree(reviewId: string, head: string, location: string): void {
  getDb().prepare('INSERT INTO branch_review_worktrees(review_id,head,path,active) VALUES (?,?,?,1) ON CONFLICT(review_id,head) DO UPDATE SET active=1,path=excluded.path').run(reviewId, head, location);
}
export function activeReviewWorktrees(reviewId: string) {
  return getDb().prepare('SELECT path,head FROM branch_review_worktrees WHERE review_id=? AND active=1').all(reviewId) as { path: string; head: string }[];
}
export function deactivateReviewWorktree(reviewId: string, head: string): void {
  getDb().prepare('UPDATE branch_review_worktrees SET active=0 WHERE review_id=? AND head=?').run(reviewId, head);
}
export function findReviewWorkspace(sessionId: string): string | undefined {
  const row = getDb().prepare('SELECT w.path FROM branch_review_threads t JOIN branch_review_worktrees w ON w.review_id=t.review_id AND w.head=t.head WHERE t.session_id=? AND w.active=1').get(sessionId) as { path: string } | undefined;
  return row?.path;
}
