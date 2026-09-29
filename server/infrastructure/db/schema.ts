import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { agentPresets } from '../../core/agents/presets';

const DATA_DIR = process.env.PLANGENT_DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'plangent.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      update_command TEXT NOT NULL DEFAULT '',
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      skills_dir TEXT NOT NULL DEFAULT '',
      skills_filename TEXT NOT NULL DEFAULT 'plangent-skills.md',
      layout_profile TEXT,
      model TEXT NOT NULL DEFAULT '',
      reasoning_effort TEXT NOT NULL DEFAULT '',
      model_options TEXT NOT NULL DEFAULT '[]',
      reasoning_options TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      default_agent_id TEXT REFERENCES agents(id),
      config TEXT NOT NULL DEFAULT '{}',
      hide_from_git INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      title TEXT,
      description TEXT,
      jira_url TEXT,
      branch_name TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, key)
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      plan_id TEXT REFERENCES plans(id),
      agent_id TEXT REFERENCES agents(id),
      agent_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      completed_steps TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      frontmatter TEXT NOT NULL DEFAULT '{}',
      agent_filter TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, slug, scope, project_id)
    );

    CREATE TABLE IF NOT EXISTS library_overrides (
      item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      agent_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      PRIMARY KEY (item_id, agent_type)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add columns that may be missing on existing DBs (idempotent)
  try { db.exec(`ALTER TABLE agents ADD COLUMN layout_profile TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN model_options TEXT NOT NULL DEFAULT '[]'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN reasoning_options TEXT NOT NULL DEFAULT '[]'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN update_command TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE projects ADD COLUMN hide_from_git INTEGER NOT NULL DEFAULT 1`); } catch { /* already exists */ }

  try { db.exec(`ALTER TABLE agents ADD COLUMN acp_command TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN acp_args TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  seedDefaultAgents(db);
  migrateData(db);
}

// Built-in agents, created on first start from their presets (core/agents/presets).
const SEEDED: [string, string][] = [['agent-claude', 'claude'], ['agent-codex', 'codex']];

function seedDefaultAgents(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM agents').get() as { cnt: number };
  if (existing.cnt > 0) return;
  const insert = db.prepare(`INSERT INTO agents (id, name, command, update_command, layout_profile) VALUES (?, ?, ?, ?, ?)`);
  for (const [id, key] of SEEDED) {
    const p = agentPresets[key];
    insert.run(id, p.name, p.command, p.update_command, JSON.stringify(p.layout_profile));
  }
}

function migrateData(db: Database.Database): void {
  // Built-in agents from installs that predate layout_profile / update_command.
  for (const [id, key] of SEEDED) {
    const p = agentPresets[key];
    db.prepare(`UPDATE agents SET layout_profile = ? WHERE id = ? AND layout_profile IS NULL`).run(JSON.stringify(p.layout_profile), id);
    db.prepare(`UPDATE agents SET update_command = ? WHERE id = ? AND trim(update_command) = ''`).run(p.update_command, id);
  }

  // Legacy common plan protocol is now runtime instructions, not a user-facing global skill.
  // Historical filesystem cleanup is no longer performed at startup.
  migrateOldSkills(db);
}

function removeLegacyGlobalRuntimeInstructions(db: Database.Database): void {
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

function migrateOldSkills(db: Database.Database): void {
  const alreadyMigrated = db.prepare(`
    SELECT COUNT(*) as cnt FROM library_items
    WHERE slug LIKE 'migrated-%' AND scope = 'project'
  `).get() as { cnt: number };
  if (alreadyMigrated.cnt > 0) return;

  const projectsDir = path.join(process.cwd(), 'data', 'skills', 'projects');
  if (fs.existsSync(projectsDir)) {
    const { v4: uuidv4 } = require('uuid');
    for (const file of fs.readdirSync(projectsDir)) {
      if (!file.endsWith('.md')) continue;
      const projectId = file.replace('.md', '');
      const content = fs.readFileSync(path.join(projectsDir, file), 'utf-8');
      if (!content.trim()) continue;

      const slug = `migrated-${projectId}`;
      const id = uuidv4();
      db.prepare(`
        INSERT OR IGNORE INTO library_items (id, type, slug, title, description, scope, project_id, frontmatter, agent_filter, enabled)
        VALUES (?, 'skill', ?, 'Инструкции проекта (мигрировано)', 'Мигрировано из projects/', 'project', ?, '{}', '[]', 1)
      `).run(id, slug, projectId);

      const libDir = path.join(process.cwd(), 'data', 'library', 'skills', slug);
      fs.mkdirSync(libDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'SKILL.md'), content);
    }
  }
}
