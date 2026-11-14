import type Database from 'better-sqlite3';

/** Each active workspace of a project gets its own port slot; existing ones are numbered in creation order. */
export function addWorkspacePortSlot(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(workspaces)').all() as { name: string }[];
  if (!columns.length || columns.some(column => column.name === 'port_slot')) return;
  db.exec('ALTER TABLE workspaces ADD COLUMN port_slot INTEGER NOT NULL DEFAULT 0');
  const active = db.prepare("SELECT id, project_id FROM workspaces WHERE status <> 'removed' ORDER BY project_id, created_at").all() as { id: string; project_id: string }[];
  const next = new Map<string, number>(), update = db.prepare('UPDATE workspaces SET port_slot=? WHERE id=?');
  for (const row of active) {
    const slot = (next.get(row.project_id) ?? 0) + 1;
    next.set(row.project_id, slot);
    update.run(slot, row.id);
  }
}
