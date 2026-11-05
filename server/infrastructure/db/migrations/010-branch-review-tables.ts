import type Database from 'better-sqlite3';
export function migrateBranchReviewTables(db: Database.Database): void {
  db.transaction(() => {
    for (const [before, after] of [['mr_worktrees', 'branch_review_worktrees'], ['mr_private_threads', 'branch_review_threads']]) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(before))
        db.exec('ALTER TABLE ' + before + ' RENAME TO ' + after);
    }
  })();
}
