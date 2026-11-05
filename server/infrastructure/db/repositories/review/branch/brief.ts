import { getDb } from '../../../schema';

export const setOverviewUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET overview=?,overview_head=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const setAnalysisUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET analysis_status=?,analysis_session=?,analysis_note=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const rSelectBranchReviews = (...params: unknown[]) => getDb().prepare("SELECT id,project_id FROM branch_reviews WHERE analysis_session=? AND analysis_status='running'").get(...params);
export const finishAnalysisUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET analysis_status=?,updated_at=datetime('now') WHERE id=?").run(...params);
export const restartDeleteBranchReviewRemarks = (...params: unknown[]) => getDb().prepare("DELETE FROM branch_review_remarks WHERE review_id=? AND author='agent' AND status='draft' AND edited=0 AND remote_id IS NULL").run(...params);
export const restartUpdateBranchReviews = (...params: unknown[]) => getDb().prepare("UPDATE branch_reviews SET overview='',overview_head='',analysis_status='',analysis_session='',analysis_note='',updated_at=datetime('now') WHERE id=?").run(...params);
