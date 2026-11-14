import type Database from 'better-sqlite3';

/** Session events, reports and queue history replace the unused run records. */
export function removeRuns(db: Database.Database): void {
  db.transaction(() => {
    const columns = db.prepare('PRAGMA table_info(agent_sessions)').all() as { name: string }[];
    if (columns.some(column => column.name === 'run_id')) db.exec('ALTER TABLE agent_sessions DROP COLUMN run_id');
    db.exec('DROP TABLE IF EXISTS runs');
  })();
}
