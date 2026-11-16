import type Database from 'better-sqlite3';
export function migrateBranchReviewTables(db: Database.Database): void {
  const exists = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const columns = (name: string) => (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map(column => column.name);
  db.transaction(() => {
    for (const [before, after] of [['mr_worktrees', 'branch_review_worktrees'], ['mr_private_threads', 'branch_review_threads']]) {
      if (!exists(before)) continue;
      if (!exists(after)) { db.exec('ALTER TABLE ' + before + ' RENAME TO ' + after); continue; }
      // Both exist (the new table was created while the old one was still there): move the old rows over, keep the new ones on conflict.
      const shared = columns(before).filter(column => columns(after).includes(column)).join(',');
      if (shared) db.exec(`INSERT OR IGNORE INTO ${after}(${shared}) SELECT ${shared} FROM ${before}`);
      db.exec('DROP TABLE ' + before);
    }
  })();
}
