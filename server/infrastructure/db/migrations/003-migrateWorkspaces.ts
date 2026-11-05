import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function migrateWorkspaces(db: Database.Database): void {
  try { db.exec(`ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE projects ADD COLUMN key TEXT`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE projects ADD COLUMN group_id TEXT REFERENCES projects(id) ON DELETE SET NULL`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_item_targets (
      item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS source_targets (
      source_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (source_id, target_id)
    );
  `);
  // A group target normally reaches the group's projects too; `own_only` limits it to the group's own folder.
  try { db.exec(`ALTER TABLE library_item_targets ADD COLUMN own_only INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
  // A group's item changed or deleted inside one project is detached from the group there:
  // `library_item_exclusions` takes the project out of the shared item, `detached_from` marks the project's own copy.
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_item_exclusions (
      item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, project_id)
    );
  `);
  try { db.exec(`ALTER TABLE library_items ADD COLUMN detached_from TEXT`); } catch { /* exists */ }
  db.transaction(() => {
    // Existing projects get an @-key from their name.
    const used = new Set((db.prepare(`SELECT key FROM projects WHERE key IS NOT NULL`).all() as { key: string }[]).map(r => r.key));
    for (const row of db.prepare(`SELECT id, name FROM projects WHERE key IS NULL AND kind <> 'group' ORDER BY created_at`).all() as { id: string; name: string }[]) {
      const base = slugify(row.name);
      let key = base;
      for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
      used.add(key);
      db.prepare(`UPDATE projects SET key=? WHERE id=?`).run(key, row.id);
    }
    // Project-scoped library items become «available for: this project».
    // project_id is cleared afterwards so this runs once and later target edits are not undone.
    db.prepare(`INSERT OR IGNORE INTO library_item_targets (item_id, target_id)
      SELECT id, project_id FROM library_items WHERE scope='project' AND project_id IS NOT NULL`).run();
    db.prepare(`UPDATE library_items SET project_id=NULL WHERE project_id IS NOT NULL`).run();
  })();
}

