import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
  `);

  // Add columns that may be missing on existing DBs (idempotent)
  try { db.exec(`ALTER TABLE agents ADD COLUMN layout_profile TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN model_options TEXT NOT NULL DEFAULT '[]'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN reasoning_options TEXT NOT NULL DEFAULT '[]'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN update_command TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE projects ADD COLUMN hide_from_git INTEGER NOT NULL DEFAULT 1`); } catch { /* already exists */ }

  seedDefaultAgents(db);
  migrateData(db);
}

const LAYOUT_CLAUDE = JSON.stringify({
  skills: { dir: '.claude/skills', global: '~/.claude/skills', file: 'plangent-<slug>/SKILL.md' },
  commands: { dir: '.claude/commands', global: '~/.claude/commands', file: 'plangent-<slug>.md' },
  main: { file: 'CLAUDE.md', global: '~/.claude/CLAUDE.md' },
});

const LAYOUT_CODEX = JSON.stringify({
  skills: { dir: '.agents/skills', global: '~/.agents/skills', file: 'plangent-<slug>/SKILL.md' },
  commands: { dir: '.agents/skills', global: '~/.agents/skills', file: 'plangent-<slug>/SKILL.md', asSkill: true },
  main: { file: 'AGENTS.md', global: '~/.codex/AGENTS.md' },
});

function seedDefaultAgents(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM agents').get() as { cnt: number };
  if (existing.cnt > 0) return;

  db.prepare(`
    INSERT INTO agents (id, name, command, update_command, args, env, skills_dir, skills_filename, layout_profile, model_options, reasoning_options) VALUES
    (
      'agent-claude',
      'Claude Code',
      'claude',
      'npm update -g @anthropic-ai/claude-code',
      '["--dangerously-skip-permissions", "--model", "{model}", "--effort", "{reasoning}"]',
      '{}',
      '.claude/commands',
      'plangent.md',
      ?,
      ?,
      ?
    ),
    (
      'agent-codex',
      'Codex CLI',
      'codex',
      'npm install -g @openai/codex@latest',
      '["--dangerously-bypass-approvals-and-sandbox", "--model", "{model}", "-c", "model_reasoning_effort={reasoning}"]',
      '{}',
      '',
      'AGENTS.md',
      ?,
      ?,
      ?
    )
  `).run(
    LAYOUT_CLAUDE, CLAUDE_MODEL_OPTIONS, CLAUDE_REASONING_OPTIONS,
    LAYOUT_CODEX, CODEX_MODEL_OPTIONS, CODEX_REASONING_OPTIONS,
  );
}

// Suggested starting values for the two built-in agents' model/reasoning-effort
// pickers — the developer can freely add, edit, or delete entries in Settings.
const CLAUDE_MODEL_OPTIONS = JSON.stringify(['sonnet', 'opus', 'haiku', 'fable']);
const CLAUDE_REASONING_OPTIONS = JSON.stringify(['low', 'medium', 'high', 'xhigh']);
const CODEX_MODEL_OPTIONS = JSON.stringify([
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark',
]);
const CODEX_REASONING_OPTIONS = JSON.stringify(['minimal', 'low', 'medium', 'high', 'xhigh']);

// Add --model/--effort placeholder flags to a default agent's args if the
// developer hasn't already customized them (no {model}/{reasoning} present).
function addModelEffortArgs(db: Database.Database, agentId: string, extraArgs: string[]): void {
  const row = db.prepare(`SELECT args FROM agents WHERE id = ?`).get(agentId) as { args: string } | undefined;
  if (!row) return;
  const args: string[] = JSON.parse(row.args || '[]');
  if (args.some(a => a.includes('{model}') || a.includes('{reasoning}'))) return;
  db.prepare(`UPDATE agents SET args = ? WHERE id = ?`).run(JSON.stringify([...args, ...extraArgs]), agentId);
}

// Backfill model/reasoning option lists for installs that already had these
// two agents seeded before model_options/reasoning_options existed.
function seedOptionsIfEmpty(db: Database.Database, agentId: string, modelOptions: string, reasoningOptions: string): void {
  const row = db.prepare(`SELECT model_options, reasoning_options FROM agents WHERE id = ?`).get(agentId) as
    { model_options: string; reasoning_options: string } | undefined;
  if (!row) return;
  if (row.model_options === '[]') {
    db.prepare(`UPDATE agents SET model_options = ? WHERE id = ?`).run(modelOptions, agentId);
  }
  if (row.reasoning_options === '[]') {
    db.prepare(`UPDATE agents SET reasoning_options = ? WHERE id = ?`).run(reasoningOptions, agentId);
  }
}

function seedUpdateCommandIfEmpty(db: Database.Database, agentId: string, updateCommand: string): void {
  const row = db.prepare(`SELECT update_command FROM agents WHERE id = ?`).get(agentId) as
    { update_command: string } | undefined;
  if (row && !row.update_command.trim()) {
    db.prepare(`UPDATE agents SET update_command = ? WHERE id = ?`).run(updateCommand, agentId);
  }
}

function migrateData(db: Database.Database): void {
  // Fix codex args if they were seeded with empty array
  const codex = db.prepare(`SELECT args FROM agents WHERE id = 'agent-codex'`).get() as { args: string } | undefined;
  if (codex && codex.args === '[]') {
    db.prepare(`UPDATE agents SET args = '["--dangerously-bypass-approvals-and-sandbox"]' WHERE id = 'agent-codex'`).run();
  }

  // Backfill layout_profile for existing agents that were seeded before this column existed
  const claudeNoLayout = db.prepare(`SELECT id FROM agents WHERE id = 'agent-claude' AND layout_profile IS NULL`).get();
  if (claudeNoLayout) {
    db.prepare(`UPDATE agents SET layout_profile = ? WHERE id = 'agent-claude'`).run(LAYOUT_CLAUDE);
  }
  const codexNoLayout = db.prepare(`SELECT id FROM agents WHERE id = 'agent-codex' AND layout_profile IS NULL`).get();
  if (codexNoLayout) {
    db.prepare(`UPDATE agents SET layout_profile = ? WHERE id = 'agent-codex'`).run(LAYOUT_CODEX);
  }

  addModelEffortArgs(db, 'agent-claude', ['--model', '{model}', '--effort', '{reasoning}']);
  addModelEffortArgs(db, 'agent-codex', ['--model', '{model}', '-c', 'model_reasoning_effort={reasoning}']);
  seedOptionsIfEmpty(db, 'agent-claude', CLAUDE_MODEL_OPTIONS, CLAUDE_REASONING_OPTIONS);
  seedOptionsIfEmpty(db, 'agent-codex', CODEX_MODEL_OPTIONS, CODEX_REASONING_OPTIONS);
  seedUpdateCommandIfEmpty(db, 'agent-claude', 'npm update -g @anthropic-ai/claude-code');
  seedUpdateCommandIfEmpty(db, 'agent-codex', 'npm install -g @openai/codex@latest');

  // Legacy common plan protocol is now runtime instructions, not a user-facing global skill.
  removeLegacyGlobalRuntimeInstructions(db);
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
