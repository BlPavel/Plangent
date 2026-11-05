import type Database from 'better-sqlite3';

export const taskSelectTasks = (db: Database.Database) => db.prepare('SELECT 1 FROM tasks WHERE id=? AND project_id=?');
export const currentSelectPlans = (db: Database.Database) => db.prepare('SELECT content,version FROM plans WHERE task_id=? ORDER BY version DESC LIMIT 1');
export const currentSelectMaterials = (db: Database.Database) => db.prepare('SELECT content,version FROM materials WHERE task_id=? AND type=? ORDER BY version DESC LIMIT 1');
export const readySelectPreparationMarks = (db: Database.Database) => db.prepare("SELECT 1 FROM preparation_marks WHERE task_id=? AND stage='qa' AND status='ready'");
export const hasQueueSelectSqliteMaster = (db: Database.Database) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_queues'");
export const queueSelectTaskQueues = (db: Database.Database) => db.prepare('SELECT data FROM task_queues WHERE task_id=?');
export const sentUpdatePlanReviewMessages = (db: Database.Database) => db.prepare('UPDATE plan_review_messages SET sent=1 WHERE remark_id=? AND sent=0');
export const deliveredUpdatePlanReviewMessages = (db: Database.Database) => db.prepare('UPDATE plan_review_messages SET sent=1 WHERE remark_id=? AND sent=0');
