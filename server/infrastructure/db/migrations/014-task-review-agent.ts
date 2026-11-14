import type Database from 'better-sqlite3';

/** The review agent chosen when the work was created (JSON: agent_id, model, effort); NULL — the project's one. */
export function addTaskReviewAgent(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  if (!columns.length || columns.some(column => column.name === 'review_agent')) return;
  db.exec('ALTER TABLE tasks ADD COLUMN review_agent TEXT');
}
