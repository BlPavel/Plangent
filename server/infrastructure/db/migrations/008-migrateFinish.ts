import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function migrateFinish(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS finish_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      scenario TEXT NOT NULL CHECK(scenario IN ('commits','push','full')),
      options TEXT NOT NULL CHECK(json_valid(options)), base_head TEXT NOT NULL,
      branch TEXT NOT NULL, snapshot_tree TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN ('branch','commits','confirmation','push','mr','done')),
      status TEXT NOT NULL CHECK(status IN ('running','waiting','error','complete','cancelled')),
      commits TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(commits)), session_id TEXT,
      note TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', output TEXT NOT NULL DEFAULT '',
      pushed INTEGER NOT NULL DEFAULT 0, mr_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS finish_one_active ON finish_runs(project_id)
      WHERE status NOT IN ('complete','cancelled');
    CREATE INDEX IF NOT EXISTS finish_task ON finish_runs(task_id, created_at);
  `);
  // Tables created before the MR stage carry the old stage CHECK; SQLite can only rebuild them.
  if (!(db.prepare("SELECT sql FROM sqlite_master WHERE name='finish_runs'").get() as { sql: string }).sql.includes("'mr'")) {
    db.exec(`
      ALTER TABLE finish_runs RENAME TO finish_runs_old;
      DROP INDEX IF EXISTS finish_one_active; DROP INDEX IF EXISTS finish_task;
      CREATE TABLE finish_runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        scenario TEXT NOT NULL CHECK(scenario IN ('commits','push','full')),
        options TEXT NOT NULL CHECK(json_valid(options)), base_head TEXT NOT NULL,
        branch TEXT NOT NULL, snapshot_tree TEXT NOT NULL,
        stage TEXT NOT NULL CHECK(stage IN ('branch','commits','confirmation','push','mr','done')),
        status TEXT NOT NULL CHECK(status IN ('running','waiting','error','complete','cancelled')),
        commits TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(commits)), session_id TEXT,
        note TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', output TEXT NOT NULL DEFAULT '',
        pushed INTEGER NOT NULL DEFAULT 0, mr_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO finish_runs SELECT * FROM finish_runs_old;
      DROP TABLE finish_runs_old;
      CREATE UNIQUE INDEX finish_one_active ON finish_runs(project_id) WHERE status NOT IN ('complete','cancelled');
      CREATE INDEX finish_task ON finish_runs(task_id, created_at);
    `);
  }
  if (!(db.prepare('PRAGMA table_info(finish_runs)').all() as { name: string }[]).some(column => column.name === 'workspace_id'))
    db.exec('ALTER TABLE finish_runs ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)');
  db.exec("DROP INDEX IF EXISTS finish_one_active; CREATE UNIQUE INDEX finish_one_active ON finish_runs(project_id, coalesce(workspace_id, '')) WHERE status NOT IN ('complete','cancelled')");
  // The MR title and description the user confirms together with the commits.
  if (!(db.prepare('PRAGMA table_info(finish_runs)').all() as { name: string }[]).some(column => column.name === 'mr_draft')) db.exec('ALTER TABLE finish_runs ADD COLUMN mr_draft TEXT');
  // Files a git hook changed after a commit: the user decides whether they belong to the commits.
  if (!(db.prepare('PRAGMA table_info(finish_runs)').all() as { name: string }[]).some(column => column.name === 'hook_changes'))
    db.exec("ALTER TABLE finish_runs ADD COLUMN hook_changes TEXT NOT NULL DEFAULT '[]'");
  db.exec(`
    UPDATE finish_runs SET status='error', error='Приложение перезапущено. Проверьте коммиты и продолжите завершение.' WHERE status='running';
  `);
  cancelOrphanFinishes(db);
}
/**
 * A finish whose task or working folder is gone can never be continued, yet it would still count as the project's active finish
 * (a deleted task leaves task_id empty, a removed working folder is no longer listed as active).
 */
export function cancelOrphanFinishes(db: Database.Database): number {
  // On a new database the workspaces table is created after this migration, and then there is nothing to cancel.
  const folders = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspaces'").get()
    ? " OR (workspace_id IS NOT NULL AND workspace_id NOT IN (SELECT id FROM workspaces WHERE status<>'removed'))" : '';
  return db.prepare(`UPDATE finish_runs SET status='cancelled', error='Задача или рабочее место удалены: завершение отменено.', updated_at=datetime('now')
    WHERE status NOT IN ('complete','cancelled') AND ((task_id IS NULL AND json_extract(options,'$.task_id') IS NOT NULL)${folders})`).run().changes;
}

