import { getDb } from '../../schema';
export function planReviewLevelsMigrated() { return !!getDb().prepare("SELECT 1 FROM app_settings WHERE key = 'plan-review-levels-to-skills'").get(); }
export function markPlanReviewLevelsMigrated() { getDb().prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('plan-review-levels-to-skills', '1', datetime('now'))").run(); }
