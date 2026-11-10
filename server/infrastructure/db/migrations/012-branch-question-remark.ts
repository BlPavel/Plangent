import type Database from 'better-sqlite3';

/**
 * A question may discuss a remark of the review or a colleague's thread: that card then shows the conversation.
 * A remark can be rejected (kept, but never published) and remembers its text from before a discussion changed it.
 */
export function addBranchQuestionRemark(db: Database.Database): void {
  const add = (table: string, name: string, definition: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.length && !columns.some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  add('branch_questions', 'remark_id', "TEXT NOT NULL DEFAULT ''");
  add('branch_questions', 'thread_id', "TEXT NOT NULL DEFAULT ''");
  add('branch_review_remarks', 'rejected', 'INTEGER NOT NULL DEFAULT 0');
  add('branch_review_remarks', 'original', "TEXT NOT NULL DEFAULT ''");
}
