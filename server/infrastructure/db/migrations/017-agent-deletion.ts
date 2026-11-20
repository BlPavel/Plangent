import type Database from 'better-sqlite3';

/** Keep historical session references while removing agents from the catalog. */
export function addAgentDeletion(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(agents)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE agents ADD COLUMN deleted_at TEXT');
  }
}
