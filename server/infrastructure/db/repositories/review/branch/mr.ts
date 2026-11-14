import { getDb } from '../../../schema';

export const pinMrUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET mr_base=?,mr_start=?,mr_head=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const rowsSelectBranchReviews = (...params: unknown[]) => getDb().prepare(`SELECT id,mr_iid FROM branch_reviews WHERE project_id=? AND mr_iid IS NOT NULL AND (
    EXISTS (SELECT 1 FROM branch_review_threads t WHERE t.review_id=branch_reviews.id) OR EXISTS (SELECT 1 FROM branch_review_worktrees w WHERE w.review_id=branch_reviews.id AND w.active=1))`).all(...params);
export const localSelectBranchReviews = (...params: unknown[]) => getDb().prepare('SELECT mr_iid,id,published_head FROM branch_reviews WHERE project_id=? AND mr_iid IS NOT NULL').all(...params);
export const openUpdateBranchReviews = (...params: unknown[]) => getDb().prepare('UPDATE branch_reviews SET mr_iid=? WHERE id=?').run(...params);
