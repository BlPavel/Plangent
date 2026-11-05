import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function migrateTaskWorkspaces(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      branch TEXT NOT NULL, base_branch TEXT NOT NULL, path TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('preparing','ready','failed','removed')),
      error TEXT NOT NULL DEFAULT '', setup_log TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')), removed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_active_branch ON workspaces(project_id,branch) WHERE status <> 'removed';
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_active_task ON workspaces(task_id) WHERE status <> 'removed';
    CREATE TRIGGER IF NOT EXISTS workspace_project_insert BEFORE INSERT ON workspaces BEGIN
      SELECT RAISE(ABORT,'Workspace requires a task of an ordinary project')
      WHERE NOT EXISTS (SELECT 1 FROM projects p JOIN tasks t ON t.project_id=p.id
        WHERE p.id=NEW.project_id AND p.kind='project' AND t.id=NEW.task_id);
    END;
    CREATE TRIGGER IF NOT EXISTS workspace_project_update BEFORE UPDATE OF project_id,task_id ON workspaces BEGIN
      SELECT RAISE(ABORT,'Workspace requires a task of an ordinary project')
      WHERE NOT EXISTS (SELECT 1 FROM projects p JOIN tasks t ON t.project_id=p.id
        WHERE p.id=NEW.project_id AND p.kind='project' AND t.id=NEW.task_id);
    END;
  `);
}

