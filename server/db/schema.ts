import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
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
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      skills_dir TEXT NOT NULL DEFAULT '',
      skills_filename TEXT NOT NULL DEFAULT 'plangent-skills.md',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      default_agent_id TEXT REFERENCES agents(id),
      config TEXT NOT NULL DEFAULT '{}',
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
  `);

  seedDefaultAgents(db);
  migrateData(db);
}

function seedDefaultAgents(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM agents').get() as { cnt: number };
  if (existing.cnt > 0) return;

  db.prepare(`
    INSERT INTO agents (id, name, command, args, env, skills_dir, skills_filename) VALUES
    (
      'agent-claude',
      'Claude Code',
      'claude',
      '["--dangerously-skip-permissions"]',
      '{}',
      '.claude/commands',
      'plangent.md'
    ),
    (
      'agent-codex',
      'Codex CLI',
      'codex',
      '["--dangerously-bypass-approvals-and-sandbox"]',
      '{}',
      '',
      'AGENTS.md'
    )
  `).run();
}

function migrateData(db: Database.Database): void {
  // Fix codex args if they were seeded with empty array
  const codex = db.prepare(`SELECT args FROM agents WHERE id = 'agent-codex'`).get() as { args: string } | undefined;
  if (codex && codex.args === '[]') {
    db.prepare(`UPDATE agents SET args = '["--dangerously-bypass-approvals-and-sandbox"]' WHERE id = 'agent-codex'`).run();
  }
}
