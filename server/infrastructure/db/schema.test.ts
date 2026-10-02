import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from './schema';
import { slugify } from '../../core/shared/slugify';
for (const legacy of [false, true]) {
  test('integration migration: ' + (legacy ? 'legacy sources' : 'fresh database'), () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      if (legacy) {
        db.exec(`CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL,
          default_agent_id TEXT, config TEXT NOT NULL DEFAULT '{}',
          hide_from_git INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
          kind TEXT NOT NULL DEFAULT 'project', key TEXT, group_id TEXT, icon TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO projects (id,name,repo_path,kind,key) VALUES ('old','Reference','/existing','source','reference');`);
      }
      migrate(db);
      migrate(db);
      if (legacy) {
        assert.deepEqual(db.prepare('SELECT source_type,repo_path,key FROM projects WHERE id=?').get('old'),
          { source_type: 'folder', repo_path: '/existing', key: 'reference' });
      }
      db.prepare('INSERT INTO integration_organizations(id,name) VALUES (?,?)').run('org','Organization');
      db.prepare('INSERT INTO integration_credentials(id,organization_id,name,secret_blob) VALUES (?,?,?,?)')
        .run('credential','org','Account',Buffer.from('encrypted'));
      db.prepare('UPDATE integration_organizations SET credential_id=? WHERE id=?').run('credential','org');
      db.prepare('INSERT INTO integration_connections(id,name,base_url,organization_id,credential_id) VALUES (?,?,?,?,?)')
        .run('connection','Docs','https://docs.example','org','credential');
      db.prepare('INSERT INTO integration_sessions(connection_id,credential_id,secret_blob) VALUES (?,?,?)')
        .run('connection','credential',Buffer.from('encrypted-session'));
      assert.throws(() => db.prepare('UPDATE integration_credentials SET secret_blob=?').run('plaintext'));
      assert.throws(() => db.prepare('UPDATE integration_sessions SET secret_blob=?').run('cookie'));
      assert.throws(() => db.exec("UPDATE integration_connections SET auth_strategy='unknown'"));
      assert.throws(() => db.exec("UPDATE integration_connections SET credential_mode='unknown'"));
      assert.throws(() => db.exec("UPDATE integration_connections SET auth_config='broken'"));
      for (const strategy of ['basic','form','auto','token','browser','api-login']) {
        db.prepare('UPDATE integration_connections SET auth_strategy=?').run(strategy);
      }
      db.exec(`INSERT INTO projects(id,name,repo_path,kind,source_type,connection_id)
        VALUES ('docs','Docs','/docs','source','docs','connection');`);
      assert.throws(() => db.exec("UPDATE projects SET source_type='unknown'"));
      assert.throws(() => db.exec("UPDATE projects SET connection_id='missing' WHERE id='docs'"));
      migrate(db);
      assert.equal((db.prepare('SELECT source_type FROM projects WHERE id=?').get('docs') as { source_type: string }).source_type,'docs');
      db.exec("DELETE FROM integration_credentials WHERE id='credential'");
      assert.equal((db.prepare('SELECT count(*) AS count FROM integration_sessions').get() as { count: number }).count,0);
      db.exec("DELETE FROM integration_connections WHERE id='connection'");
      assert.equal((db.prepare('SELECT connection_id FROM projects WHERE id=?').get('docs') as { connection_id: null }).connection_id,null);
      assert.deepEqual(db.pragma('foreign_key_check'),[]);
      assert.equal(slugify('Заказы'), 'zakazy');
    } finally { db.close(); }
  });
}