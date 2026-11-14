import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function removeLegacyGlobalRuntimeInstructions(db: Database.Database): void {
  const row = db.prepare(`
    SELECT id FROM library_items
    WHERE type = 'skill' AND scope = 'global' AND slug = 'migrated-common'
  `).get() as { id: string } | undefined;

  if (row) {
    db.prepare(`DELETE FROM library_items WHERE id = ?`).run(row.id);
  }

  const libDir = path.join(process.cwd(), 'data', 'library', 'skills', 'migrated-common');
  try {
    fs.rmSync(libDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  for (const dir of [
    path.join(os.homedir(), '.agents', 'skills', 'plangent-migrated-common'),
    path.join(os.homedir(), '.claude', 'skills', 'plangent-migrated-common'),
  ]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

