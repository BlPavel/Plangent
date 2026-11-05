import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function migrateCodeReviews(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS code_review (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        branch TEXT,
        head_commit TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','abandoned')),
        origin TEXT NOT NULL CHECK(origin IN ('project','task')),
        origin_id TEXT NOT NULL,
        head_start TEXT NOT NULL,
        head_last TEXT NOT NULL DEFAULT '',
        number INTEGER NOT NULL DEFAULT 0,
        head_end TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT,
        CHECK(branch IS NOT NULL OR head_commit IS NOT NULL)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS code_review_open_branch
        ON code_review(project_id, branch) WHERE status='open' AND branch IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS code_review_open_detached
        ON code_review(project_id, head_commit) WHERE status='open' AND branch IS NULL;
      CREATE INDEX IF NOT EXISTS code_review_project ON code_review(project_id, created_at);
      CREATE TABLE IF NOT EXISTS code_review_round (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES code_review(id) ON DELETE CASCADE,
        n INTEGER NOT NULL CHECK(n > 0),
        snapshot_tree TEXT NOT NULL,
        session_id TEXT,
        sent_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(review_id, n),
        UNIQUE(review_id, id)
      );
      CREATE TABLE IF NOT EXISTS code_review_item (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES code_review(id) ON DELETE CASCADE,
        round_id TEXT,
        author TEXT NOT NULL DEFAULT 'developer' CHECK(author IN ('developer','agent')),
        scope TEXT NOT NULL CHECK(scope IN ('line','file','general')),
        file TEXT,
        line_start INTEGER,
        line_end INTEGER,
        side TEXT NOT NULL DEFAULT 'new' CHECK(side IN ('new','old')),
        kind TEXT NOT NULL CHECK(kind IN ('fix','question')),
        text TEXT NOT NULL,
        refs TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(refs) AND json_type(refs)='array'),
        code_snippet TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK(status IN ('draft','sent','done','answered','needs_decision','rejected')),
        answer TEXT,
        outdated INTEGER NOT NULL DEFAULT 0 CHECK(outdated IN (0,1)),
        carried_from_item_id TEXT REFERENCES code_review_item(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(review_id, round_id) REFERENCES code_review_round(review_id, id) ON DELETE CASCADE,
        CHECK(
          (scope='general' AND file IS NULL AND line_start IS NULL AND line_end IS NULL) OR
          (scope='file' AND file IS NOT NULL AND line_start IS NULL AND line_end IS NULL) OR
          (scope='line' AND file IS NOT NULL AND line_start IS NOT NULL AND line_start > 0
            AND (line_end IS NULL OR line_end >= line_start))
        )
      );
      CREATE INDEX IF NOT EXISTS code_review_item_round ON code_review_item(review_id, round_id);
      CREATE INDEX IF NOT EXISTS code_review_item_carried ON code_review_item(carried_from_item_id);
      CREATE TABLE IF NOT EXISTS code_review_file_view (
        review_id TEXT NOT NULL REFERENCES code_review(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1)),
        viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(review_id, path)
      );
    `);
    const itemColumns = db.prepare('PRAGMA table_info(code_review_item)').all() as { name: string }[];
    if (!itemColumns.some(c => c.name === 'origin')) db.exec("ALTER TABLE code_review_item ADD COLUMN origin TEXT NOT NULL DEFAULT 'project'");
    if (!itemColumns.some(c => c.name === 'origin_id')) db.exec('ALTER TABLE code_review_item ADD COLUMN origin_id TEXT');
    if (!itemColumns.some(c => c.name === 'task_key')) db.exec('ALTER TABLE code_review_item ADD COLUMN task_key TEXT');
    if (!itemColumns.some(c => c.name === 'comparison_base')) db.exec('ALTER TABLE code_review_item ADD COLUMN comparison_base TEXT');
    if (!itemColumns.some(column => column.name === 'closed')) {
      db.exec('ALTER TABLE code_review_item ADD COLUMN closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1))');
      db.exec("UPDATE code_review_item SET closed=1 WHERE status IN ('done','answered','rejected')");
    }
    // Sent threads used to go stale when the agent edited their lines; only drafts can be outdated.
    db.exec("UPDATE code_review_item SET outdated=0 WHERE outdated=1 AND status<>'draft'");
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='code_review_message'").get()) {
      db.exec(`
        CREATE TABLE code_review_message (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES code_review_item(id) ON DELETE CASCADE,
          author TEXT NOT NULL CHECK(author IN ('developer','agent')),
          kind TEXT NOT NULL CHECK(kind IN ('text','implement','answer','options','questions','change','disagree')),
          text TEXT NOT NULL,
          options TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(options)),
          choice INTEGER,
          files TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(files)),
          round_id TEXT REFERENCES code_review_round(id) ON DELETE SET NULL,
          sent INTEGER NOT NULL DEFAULT 0 CHECK(sent IN (0,1)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now'))
        );
        CREATE INDEX code_review_message_item ON code_review_message(item_id, created_at);
      `);
      // Answers given before threads existed become the first agent message of their thread.
      db.exec(`INSERT INTO code_review_message(id,item_id,author,kind,text,round_id,sent)
        SELECT lower(hex(randomblob(16))), id, 'agent',
          CASE status WHEN 'done' THEN 'change' WHEN 'needs_decision' THEN 'disagree' ELSE 'answer' END, answer, round_id, 1
        FROM code_review_item WHERE answer IS NOT NULL AND answer<>''`);
    }
    const reviewColumns = db.prepare('PRAGMA table_info(code_review)').all() as { name: string }[];
    if (!reviewColumns.some(column => column.name === 'head_last')) {
      db.exec("ALTER TABLE code_review ADD COLUMN head_last TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE code_review SET head_last=coalesce(head_end,head_start)");
    }
    if (!reviewColumns.some(column => column.name === 'number')) {
      db.exec('ALTER TABLE code_review ADD COLUMN number INTEGER NOT NULL DEFAULT 0');
      // Display numbers ("Ревью #3") count per project in creation order.
      db.exec('UPDATE code_review SET number=(SELECT count(*) FROM code_review r WHERE r.project_id=code_review.project_id AND r.rowid<=code_review.rowid)');
    }
    const columns = db.prepare('PRAGMA table_info(code_review_file_view)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'invalidated'))
      db.exec('ALTER TABLE code_review_file_view ADD COLUMN invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1))');
  })();
}
