import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function migratePlanReviewTargets(db: Database.Database): void {
  if ((db.prepare('PRAGMA table_info(plan_reviews)').all() as { name: string }[]).some(column => column.name === 'target')) return;
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE plan_reviews_rebuild (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          plan_version INTEGER NOT NULL, plan_content TEXT NOT NULL, round INTEGER NOT NULL,
          session_id TEXT, skill_id TEXT, overview TEXT NOT NULL DEFAULT '',
          coverage TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(coverage)),
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','failed')),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
          target TEXT NOT NULL DEFAULT 'plan' CHECK(target IN ('plan','architecture','qa')), UNIQUE(task_id,target,round)
        );
        INSERT INTO plan_reviews_rebuild (id,task_id,plan_version,plan_content,round,session_id,skill_id,overview,coverage,status,created_at)
          SELECT id,task_id,plan_version,plan_content,round,session_id,skill_id,overview,coverage,status,created_at FROM plan_reviews;
        DROP TABLE plan_reviews;
        ALTER TABLE plan_reviews_rebuild RENAME TO plan_reviews;
        CREATE TABLE plan_review_remarks_rebuild (
          id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES plan_reviews(id) ON DELETE CASCADE,
          steps TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(steps)),
          kind TEXT NOT NULL CHECK(kind IN ('contradiction','order','coverage','extra','unclear','risk','suggestion')),
          text TEXT NOT NULL, suggestion TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','discussing','rejected','sent','applied','answered')),
          decision TEXT NOT NULL DEFAULT '', sent_status TEXT CHECK(sent_status IN ('accepted','discussing')),
          planner_session_id TEXT, outdated INTEGER NOT NULL DEFAULT 0 CHECK(outdated IN (0,1)), applied_version INTEGER, original TEXT CHECK(original IS NULL OR json_valid(original)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')), quote TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO plan_review_remarks_rebuild (id,review_id,steps,kind,text,suggestion,status,decision,sent_status,planner_session_id,outdated,applied_version,original,created_at)
          SELECT id,review_id,steps,kind,text,suggestion,status,decision,sent_status,planner_session_id,outdated,applied_version,original,created_at FROM plan_review_remarks;
        DROP TABLE plan_review_remarks;
        ALTER TABLE plan_review_remarks_rebuild RENAME TO plan_review_remarks;
        CREATE INDEX plan_review_remarks_review ON plan_review_remarks(review_id);
      `);
    })();
  } finally { db.pragma('foreign_keys = ' + (foreignKeys ? 'ON' : 'OFF')); }
}

