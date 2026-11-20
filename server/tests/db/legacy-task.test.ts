import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

test('legacy task and its plan survive migration and reopening on disk', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-legacy-task-'));
  const previous = process.env.PLANGENT_DATA_DIR;
  process.env.PLANGENT_DATA_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.PLANGENT_DATA_DIR;
    else process.env.PLANGENT_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const legacy = new Database(path.join(directory, 'plangent.db'));
  try {
    legacy.pragma('foreign_keys = OFF');
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL,
        default_agent_id TEXT REFERENCES agents(id), config TEXT NOT NULL DEFAULT '{}',
        hide_from_git INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL, title TEXT, description TEXT, jira_url TEXT, branch_name TEXT,
        status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(project_id, key));
      CREATE TABLE plans (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO projects (id, name, repo_path) VALUES ('project', 'Legacy project', '/legacy');
      INSERT INTO tasks (id, project_id, key, title, description, branch_name)
        VALUES ('task', 'project', 'LEG-1', 'Old task', 'Saved description', 'feature/legacy');
      INSERT INTO plans (id, task_id, content, version) VALUES ('plan', 'task', '- [ ] (p1) Saved step', 3);
    `);
  } finally {
    legacy.close();
  }

  await import('../../core-services');
  const { closeDb, getDb } = await import('../../infrastructure/db/schema');
  const { getTask } = await import('../../core/tasks');
  const { getLatestPlan, listAnalysisSections } = await import('../../core/preparation');
  try {
    for (let opening = 0; opening < 2; opening++) {
      const task = getTask('task');
      assert.deepEqual([task?.project_id, task?.key, task?.title, task?.description, task?.branch_name],
        ['project', 'LEG-1', 'Old task', null, 'feature/legacy']);
      assert.deepEqual(listAnalysisSections('task').map(section => [section.slug, section.description]),
        [['task-description', 'Saved description']]);
      const plan = getLatestPlan('task');
      assert.deepEqual([plan?.id, plan?.task_id, plan?.version, plan?.content],
        ['plan', 'task', 3, '- [ ] (p1) Saved step']);
      assert.deepEqual(getDb().pragma('foreign_key_check'), []);
      closeDb();
    }
  } finally {
    closeDb();
  }
});
