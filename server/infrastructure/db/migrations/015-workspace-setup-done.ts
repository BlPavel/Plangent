import type Database from 'better-sqlite3';

/** Setup (copied files, dependency folders, setup command) runs when work starts; workspaces that already exist are set up. */
export function addWorkspaceSetupDone(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(workspaces)').all() as { name: string }[];
  if (!columns.length || columns.some(column => column.name === 'setup_done')) return;
  db.exec('ALTER TABLE workspaces ADD COLUMN setup_done INTEGER NOT NULL DEFAULT 1');
}
