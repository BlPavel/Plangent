import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function migrateIntegrations(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS integration_organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        credential_id TEXT REFERENCES integration_credentials(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS integration_credentials (
        id TEXT PRIMARY KEY,
        organization_id TEXT REFERENCES integration_organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        secret_blob BLOB CHECK(secret_blob IS NULL OR typeof(secret_blob) = 'blob'),
        status TEXT NOT NULL DEFAULT 'needs_update' CHECK(status IN ('ready','needs_update')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS integration_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        organization_id TEXT REFERENCES integration_organizations(id) ON DELETE SET NULL,
        credential_mode TEXT NOT NULL DEFAULT 'inherit' CHECK(credential_mode IN ('inherit','credential','own')),
        credential_id TEXT REFERENCES integration_credentials(id) ON DELETE SET NULL,
        auth_strategy TEXT NOT NULL DEFAULT 'auto' CHECK(auth_strategy IN ('basic','form','auto','token','browser','api-login')),
        auth_config TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(auth_config)),
        last_check_status TEXT NOT NULL DEFAULT 'unchecked' CHECK(last_check_status IN ('unchecked','ok','error','needs_update')),
        last_check_at TEXT,
        last_check_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS integration_sessions (
        connection_id TEXT PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
        credential_id TEXT REFERENCES integration_credentials(id) ON DELETE CASCADE,
        credential_revision INTEGER NOT NULL DEFAULT 1 CHECK(credential_revision > 0),
        secret_blob BLOB NOT NULL CHECK(typeof(secret_blob) = 'blob'),
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS integration_credentials_organization ON integration_credentials(organization_id);
      CREATE INDEX IF NOT EXISTS integration_connections_organization ON integration_connections(organization_id);
      CREATE INDEX IF NOT EXISTS integration_connections_credential ON integration_connections(credential_id);
      CREATE INDEX IF NOT EXISTS integration_sessions_credential ON integration_sessions(credential_id);
    `);
    const columns: [string, string][] = [
      ['source_type', "TEXT NOT NULL DEFAULT 'folder' CHECK(source_type IN ('folder','docs'))"],
      ['connection_id', 'TEXT REFERENCES integration_connections(id) ON DELETE SET NULL'],
      ['docs_config', "TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(docs_config))"],
      ['docs_selection', "TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(docs_selection))"],
      ['sync_status', "TEXT NOT NULL DEFAULT 'idle' CHECK(sync_status IN ('idle','running','done','error','cancelled'))"],
      ['last_sync_at', 'TEXT'],
      ['sync_stats', "TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(sync_stats))"],
    ];
    const existing = new Set((db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(r => r.name));
    for (const [name, definition] of columns) {
      if (existing.has(name)) continue;
      // Catch only a concurrent duplicate-column migration; all other errors must abort.
      try { db.exec('ALTER TABLE projects ADD COLUMN ' + name + ' ' + definition); }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('duplicate column name')) throw error;
      }
    }
    db.exec('CREATE INDEX IF NOT EXISTS projects_connection ON projects(connection_id)');
  })();
}
