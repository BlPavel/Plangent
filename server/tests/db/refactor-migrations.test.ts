import '../../core-services';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateBranchReviewTables } from '../../infrastructure/db/migrations/010-branch-review-tables';
import { removeRuns } from '../../infrastructure/db/migrations/011-remove-runs';

test('review table rename and run removal preserve sessions, threads and messages and are idempotent', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    db.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY);
      INSERT INTO runs VALUES ('run');
      CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id) ON DELETE SET NULL, metadata TEXT);
      INSERT INTO agent_sessions VALUES ('session', 'run', '{"briefing":"saved"}');
      CREATE TABLE agent_session_events (session_id TEXT REFERENCES agent_sessions(id), text TEXT);
      INSERT INTO agent_session_events VALUES ('session', 'report');
      CREATE TABLE mr_worktrees (review_id TEXT, path TEXT);
      INSERT INTO mr_worktrees VALUES ('review', '/worktree');
      CREATE TABLE mr_private_threads (id TEXT PRIMARY KEY, session_id TEXT REFERENCES agent_sessions(id));
      INSERT INTO mr_private_threads VALUES ('thread', 'session');`);
    for (let i = 0; i < 2; i++) { migrateBranchReviewTables(db); removeRuns(db); }
    assert.deepEqual(db.prepare('SELECT * FROM agent_sessions').get(), { id: 'session', metadata: '{"briefing":"saved"}' });
    assert.deepEqual(db.prepare('SELECT * FROM agent_session_events').get(), { session_id: 'session', text: 'report' });
    assert.deepEqual(db.prepare('SELECT * FROM branch_review_worktrees').get(), { review_id: 'review', path: '/worktree' });
    assert.deepEqual(db.prepare('SELECT * FROM branch_review_threads').get(), { id: 'thread', session_id: 'session' });
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('runs','mr_worktrees','mr_private_threads')").get(), undefined);
  } finally { db.close(); }
});
