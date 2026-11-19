import type Database from 'better-sqlite3';

export function addAgentProxy(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(agents)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'use_proxy')) {
    db.exec('ALTER TABLE agents ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 0 CHECK(use_proxy IN (0,1))');
  }
}
