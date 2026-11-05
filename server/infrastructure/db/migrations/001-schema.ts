import { removeRuns } from './011-remove-runs';
import { migrateBranchReviewTables } from './010-branch-review-tables';
import type Database from 'better-sqlite3';
import { migrateTaskWorkspaces } from './002-migrateTaskWorkspaces';
import { migrateWorkspaces } from './003-migrateWorkspaces';
import { removeLegacyGlobalRuntimeInstructions } from './004-removeLegacyGlobalRuntimeInstructions';
import { migrateOldSkills } from './005-migrateOldSkills';
import { migrateIntegrations } from './006-migrateIntegrations';
import { migrateCodeReviews } from './007-migrateCodeReviews';
import { migrateFinish } from './008-migrateFinish';
import { migratePlanReviewTargets } from './009-migratePlanReviewTargets';
export function migrate(db: Database.Database): void {
  migrateBranchReviewTables(db);
  removeRuns(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('architecture','qa')), content TEXT NOT NULL,
      version INTEGER NOT NULL, author TEXT NOT NULL CHECK(author IN ('developer','agent')),
      session_id TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
      UNIQUE(task_id,type,version)
    );
    CREATE TABLE IF NOT EXISTS preparation_marks (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK(stage IN ('analysis','architecture','qa','plan')),
      status TEXT NOT NULL CHECK(status IN ('ready','skipped')),
      material_version TEXT NOT NULL,
      marked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
      PRIMARY KEY(task_id,stage)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_reviews (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      plan_version INTEGER NOT NULL, plan_content TEXT NOT NULL, round INTEGER NOT NULL,
      session_id TEXT, skill_id TEXT, overview TEXT NOT NULL DEFAULT '',
      coverage TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(coverage)),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','failed')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
      target TEXT NOT NULL DEFAULT 'plan' CHECK(target IN ('plan','architecture','qa')), UNIQUE(task_id,target,round)
    );
    CREATE TABLE IF NOT EXISTS plan_review_remarks (
      id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES plan_reviews(id) ON DELETE CASCADE,
      steps TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(steps)),
      kind TEXT NOT NULL CHECK(kind IN ('contradiction','order','coverage','extra','unclear','risk','suggestion')),
      text TEXT NOT NULL, suggestion TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','discussing','rejected','sent','applied','answered')),
      decision TEXT NOT NULL DEFAULT '', sent_status TEXT CHECK(sent_status IN ('accepted','discussing')),
      planner_session_id TEXT, outdated INTEGER NOT NULL DEFAULT 0 CHECK(outdated IN (0,1)), applied_version INTEGER, original TEXT CHECK(original IS NULL OR json_valid(original)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')), quote TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS plan_review_remarks_review ON plan_review_remarks(review_id);
    CREATE TABLE IF NOT EXISTS plan_review_messages (
      id TEXT PRIMARY KEY, remark_id TEXT NOT NULL REFERENCES plan_review_remarks(id) ON DELETE CASCADE,
      author TEXT NOT NULL CHECK(author IN ('developer','reviewer','planner')),
      text TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0 CHECK(sent IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
    );
    CREATE INDEX IF NOT EXISTS plan_review_messages_remark ON plan_review_messages(remark_id);
  `);
  // The text a card had before it was rewritten after a discussion (null: never rewritten).
  try { db.exec('ALTER TABLE plan_review_remarks ADD COLUMN original TEXT'); } catch { /* already exists */ }
  migratePlanReviewTargets(db);

  db.exec(`CREATE TABLE IF NOT EXISTS conflict_resolutions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, operation_id TEXT NOT NULL, session_id TEXT NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')));
    CREATE TABLE IF NOT EXISTS conflict_files (resolution_id TEXT NOT NULL REFERENCES conflict_resolutions(id) ON DELETE CASCADE, step TEXT NOT NULL, path TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('resolved','question','recommend')), text TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', answer_sent INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')), PRIMARY KEY(resolution_id,step,path));`);
  db.exec(`CREATE TABLE IF NOT EXISTS branch_review_worktrees (review_id TEXT NOT NULL, head TEXT NOT NULL, path TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(review_id,head));
    CREATE TABLE IF NOT EXISTS branch_review_threads (id TEXT PRIMARY KEY, review_id TEXT NOT NULL, head TEXT NOT NULL, path TEXT NOT NULL, side TEXT NOT NULL, line INTEGER NOT NULL, session_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS branch_reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL, base TEXT NOT NULL, seen_head TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(project_id,branch,base));
    CREATE TABLE IF NOT EXISTS branch_review_viewed (review_id TEXT NOT NULL, path TEXT NOT NULL, sig TEXT NOT NULL, PRIMARY KEY(review_id,path));
    CREATE TABLE IF NOT EXISTS branch_questions (id TEXT PRIMARY KEY, review_id TEXT NOT NULL, path TEXT NOT NULL DEFAULT '', side TEXT NOT NULL DEFAULT 'new', line INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')));
    CREATE TABLE IF NOT EXISTS branch_question_messages (id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES branch_questions(id) ON DELETE CASCADE, author TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')));
    CREATE TABLE IF NOT EXISTS branch_review_remarks (id TEXT PRIMARY KEY, review_id TEXT NOT NULL, path TEXT NOT NULL DEFAULT '', side TEXT NOT NULL DEFAULT 'new', line INTEGER NOT NULL DEFAULT 0, head TEXT NOT NULL, body TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT 'developer' CHECK(author IN ('developer','agent')), category TEXT NOT NULL DEFAULT '', remote_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','uncertain')), error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')));`);
  // A review opened from a merge request, the developer's context for the agent and the agent's overview.
  const reviewColumns = new Set((db.prepare('PRAGMA table_info(branch_reviews)').all() as { name: string }[]).map(c => c.name));
  for (const [name, type] of [['mr_iid', 'INTEGER'], ['mr_base', "TEXT NOT NULL DEFAULT ''"], ['mr_start', "TEXT NOT NULL DEFAULT ''"], ['mr_head', "TEXT NOT NULL DEFAULT ''"],
    ['context', "TEXT NOT NULL DEFAULT ''"], ['task_id', 'TEXT'], ['skill_id', 'TEXT'], ['overview', "TEXT NOT NULL DEFAULT ''"], ['overview_head', "TEXT NOT NULL DEFAULT ''"], ['published_head', "TEXT NOT NULL DEFAULT ''"],
    ['analysis_status', "TEXT NOT NULL DEFAULT ''"], ['analysis_session', "TEXT NOT NULL DEFAULT ''"], ['analysis_note', "TEXT NOT NULL DEFAULT ''"]])
    if (!reviewColumns.has(name)) db.exec(`ALTER TABLE branch_reviews ADD COLUMN ${name} ${type}`);
  // An agent's draft the developer has changed is theirs to keep when the review starts over.
  const remarkColumns = new Set((db.prepare('PRAGMA table_info(branch_review_remarks)').all() as { name: string }[]).map(c => c.name));
  if (!remarkColumns.has('edited')) db.exec('ALTER TABLE branch_review_remarks ADD COLUMN edited INTEGER NOT NULL DEFAULT 0');

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

  db.exec('CREATE TABLE IF NOT EXISTS mr_creation_intents (id TEXT PRIMARY KEY)');
  migrateFinish(db);
  for (const name of ['finish_scenario', 'target_branch', 'external_key', 'base_branch', 'mr_link', 'base_commit']) {
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
    if (!columns.some(column => column.name === name)) db.exec('ALTER TABLE tasks ADD COLUMN ' + name + ' TEXT');
  }

  const workColumns = new Set((db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map(c => c.name));
  for (const [name, definition] of Object.entries({
    kind: "TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task','errand'))",
    auto_review: "INTEGER NOT NULL DEFAULT 0 CHECK(auto_review IN (0,1))",
    closed_at: 'TEXT', close_reason: "TEXT CHECK(close_reason IN ('done','cancelled'))",
    origin_task_id: 'TEXT REFERENCES tasks(id) ON DELETE SET NULL',
  })) if (!workColumns.has(name)) db.exec('ALTER TABLE tasks ADD COLUMN ' + name + ' ' + definition);

  // Add columns that may be missing on existing DBs (idempotent)
  const planColumns = db.prepare('PRAGMA table_info(plans)').all() as { name: string }[];
  if (!planColumns.some(column => column.name === 'session_id')) db.exec('ALTER TABLE plans ADD COLUMN session_id TEXT');
  if (!planColumns.some(column => column.name === 'author')) db.exec("ALTER TABLE plans ADD COLUMN author TEXT NOT NULL DEFAULT 'developer'");
  try { db.exec(`ALTER TABLE agents ADD COLUMN layout_profile TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN model_options TEXT NOT NULL DEFAULT '[]'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN reasoning_options TEXT NOT NULL DEFAULT '[]'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN update_command TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE projects ADD COLUMN hide_from_git INTEGER NOT NULL DEFAULT 1`); } catch { /* already exists */ }

  try { db.exec(`ALTER TABLE agents ADD COLUMN acp_command TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE agents ADD COLUMN acp_args TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  migrateOldSkills(db);
  migrateWorkspaces(db);
  migrateTaskWorkspaces(db);
  migrateIntegrations(db);
  if (!(db.prepare('PRAGMA table_info(integration_connections)').all() as { name: string }[]).some(c => c.name === 'code_host'))
    db.exec('ALTER TABLE integration_connections ADD COLUMN code_host TEXT');
  migrateCodeReviews(db);
  db.exec('DROP TABLE IF EXISTS mr_review_viewed; DROP TABLE IF EXISTS mr_review_drafts; DROP TABLE IF EXISTS mr_reviews');
  for (const [name, definition] of [['clone_url', "TEXT NOT NULL DEFAULT ''"], ['host_project_path', "TEXT NOT NULL DEFAULT ''"], ['git_settings', "TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(git_settings))"]]) {
    const columns = db.prepare('PRAGMA table_info(projects)').all() as { name: string }[];
    if (!columns.some(column => column.name === name)) db.exec('ALTER TABLE projects ADD COLUMN ' + name + ' ' + definition);
  }
  try { db.exec('ALTER TABLE tasks ADD COLUMN description_migrated INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
  // Clear the old field in the same transaction: reopening/deleting the section cannot repeat migration.
  db.transaction(() => {
    db.prepare(`INSERT INTO analysis_sections (id, task_id, slug, title, description, kind, author, position)
      SELECT lower(hex(randomblob(16))), id, 'task-description', 'Описание задачи', description, 'source', 'developer', -1
      FROM tasks WHERE description_migrated=0 AND trim(coalesce(description, '')) <> ''`).run();
    db.prepare("UPDATE tasks SET description=NULL, description_migrated=1 WHERE description_migrated=0").run();
  })();
}

