import { getDb } from '../../../schema';

export const rSelectBranchReviews = (...params: unknown[]) => getDb().prepare('SELECT * FROM branch_reviews WHERE id=? AND project_id=?').get(...params);
export const existingSelectBranchReviews = (...params: unknown[]) => getDb().prepare('SELECT id FROM branch_reviews WHERE project_id=? AND branch=? AND base=?').get(...params);
export const lastSelectBranchReviews = (...params: unknown[]) => getDb().prepare('SELECT skill_id FROM branch_reviews WHERE project_id=? AND skill_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1').get(...params);
export const ensureReviewInsertBranchReviews = (...params: unknown[]) => getDb().prepare('INSERT INTO branch_reviews(id,project_id,branch,base,skill_id) VALUES (?,?,?,?,?)').run(...params);
export const acknowledgeUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET seen_head=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const setContextUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET context=?,task_id=?,skill_id=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const threadsSelectBranchReviewThreads = (...params: unknown[]) => getDb().prepare('SELECT * FROM branch_review_threads WHERE review_id=? ORDER BY rowid').all(...params);
export const openThreadInsertBranchReviewThreads = (...params: unknown[]) => getDb().prepare('INSERT INTO branch_review_threads(id,review_id,head,path,side,line,session_id) VALUES (?,?,?,?,?,?,?)').run(...params);
export const finishThreadsDeleteBranchReviewThreads = (...params: unknown[]) => getDb().prepare('DELETE FROM branch_review_threads WHERE review_id=?').run(...params);
