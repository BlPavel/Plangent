import { getDb } from '../../../schema';

export const allSelectBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('SELECT * FROM branch_review_remarks WHERE review_id=? ORDER BY created_at,rowid').all(...params);
export const rSelectBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('SELECT * FROM branch_review_remarks WHERE id=? AND review_id=?').get(...params);
export const insertInsertBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('INSERT INTO branch_review_remarks(id,review_id,path,side,line,head,body,author) VALUES (?,?,?,?,?,?,?,?)').run(...params);
export const editUpdateBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('UPDATE branch_review_remarks SET body=?,error=?,edited=? WHERE id=?').run(...params);
export const rejectUpdateBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('UPDATE branch_review_remarks SET rejected=? WHERE id=?').run(...params);
export const reviseUpdateBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('UPDATE branch_review_remarks SET body=?,original=? WHERE id=?').run(...params);
export const removeDeleteBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('DELETE FROM branch_review_remarks WHERE id=?').run(...params);
export const detachUpdateBranchReviewRemarks = (...params: unknown[]) => getDb().prepare("UPDATE branch_review_remarks SET path='',side='new',line=0,body=? WHERE id=?").run(...params);
export const saveUpdateBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('UPDATE branch_review_remarks SET remote_id=?,status=?,error=? WHERE id=?').run(...params);
export const publishUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET published_head=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const dSelectBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('SELECT * FROM branch_review_remarks WHERE id=? AND review_id=?').get(...params);
export const recoverUpdateBranchReviewRemarks = (...params: unknown[]) => getDb().prepare('UPDATE branch_review_remarks SET status=?,error=? WHERE id=?').run(...params);
export const markSentUpdateBranchReviewRemarks = (...params: unknown[]) => getDb().prepare("UPDATE branch_review_remarks SET status='sent',error='' WHERE id=?").run(...params);
export const markSentUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET published_head=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const rSelectBranchReviews = (...params: unknown[]) => getDb().prepare('SELECT * FROM branch_reviews WHERE id=?').get(...params);
