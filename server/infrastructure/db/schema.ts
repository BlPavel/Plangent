import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { agentPresets } from '../../core/agents/presets';
import { slugify } from '../../core/shared/slugify';

export const DATA_DIR = process.env.PLANGENT_DATA_DIR || path.join(process.cwd(), 'data');
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

export function migrate(db: Database.Database): void {
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


    CREATE TABLE IF NOT EXISTS analysis_sections (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('source', 'worked')),
      author TEXT NOT NULL CHECK(author IN ('developer', 'agent')),
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, slug)
    );
    CREATE TABLE IF NOT EXISTS analysis_files (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL REFERENCES analysis_sections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL CHECK(size >= 0 AND size <= 26214400),
      content BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(section_id, name)
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


    CREATE TABLE IF NOT EXISTS library_proposals (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','applied','rejected','stale')),
      data TEXT NOT NULL, applied_item_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS library_proposals_project ON library_proposals(project_id, created_at);
    CREATE INDEX IF NOT EXISTS library_proposals_session ON library_proposals(session_id, created_at);
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
  migrateWorkspaces(db);
  migrateIntegrations(db);
  try { db.exec('ALTER TABLE tasks ADD COLUMN description_migrated INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
  // Clear the old field in the same transaction: reopening/deleting the section cannot repeat migration.
  db.transaction(() => {
    db.prepare(`INSERT INTO analysis_sections (id, task_id, slug, title, description, kind, author, position)
      SELECT lower(hex(randomblob(16))), id, 'task-description', 'Описание задачи', description, 'source', 'developer', -1
      FROM tasks WHERE description_migrated=0 AND trim(coalesce(description, '')) <> ''`).run();
    db.prepare("UPDATE tasks SET description=NULL, description_migrated=1 WHERE description_migrated=0").run();
  })();
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

/**
 * Groups and reference sources are rows of `projects` too (`kind`), so tasks, chats, plans and queues work
 * for a group unchanged. Library items and sources are shared through target rows instead of one project_id.
 */
function migrateWorkspaces(db: Database.Database): void {
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

/** Idempotent additive migration: existing folder sources keep their data and targets. */
function migrateIntegrations(db: Database.Database): void {
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