import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-commit-rules-'));
process.env.PLANGENT_DATA_DIR = data;

test('commit rules: built-in default, then global, group and project levels, nearest wins', async t => {
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createLibraryItem, deleteLibraryItem } = await import('./index');
  const { writeItemContent } = await import('./library-manager');
  const { DEFAULT_COMMIT_RULES, resolveCommitRules } = await import('./commit-rules');
  const db = getDb();
  t.after(() => { db.close(); fs.rmSync(data, { recursive: true, force: true }); });
  assert.match(DEFAULT_COMMIT_RULES, /English/);
  assert.match(DEFAULT_COMMIT_RULES, /under 10 words/);
  db.prepare("INSERT INTO projects (id,kind,name,key,repo_path) VALUES ('g','group','G','g','/tmp/g')").run();
  db.prepare("INSERT INTO projects (id,kind,name,key,repo_path,group_id) VALUES ('p','project','P','p','/tmp/p','g')").run();
  const make = (scope: 'global' | 'project', targets: string[], text: string) => {
    const item = createLibraryItem({ type: 'commit-rules', slug: 'commit_rules', title: 'Rules', description: '', scope, targets, own_only: [], frontmatter: {}, agent_filter: [], enabled: true } as never);
    writeItemContent(item, text);
    return item;
  };
  assert.equal(resolveCommitRules(), DEFAULT_COMMIT_RULES);
  assert.equal(resolveCommitRules('p'), DEFAULT_COMMIT_RULES);
  const global = make('global', [], 'Use Russian, max 5 words.');
  assert.equal(resolveCommitRules(), 'Use Russian, max 5 words.');
  assert.equal(resolveCommitRules('p'), 'Use Russian, max 5 words.');
  const group = make('project', ['g'], 'feat/fix: what was done [branch]');
  assert.equal(resolveCommitRules('p'), 'feat/fix: what was done [branch]');
  const own = make('project', ['p'], 'Project own rules');
  assert.equal(resolveCommitRules('p'), 'Project own rules');
  deleteLibraryItem(own.id); deleteLibraryItem(group.id);
  assert.equal(resolveCommitRules('p'), 'Use Russian, max 5 words.');
  deleteLibraryItem(global.id);
  assert.equal(resolveCommitRules('p'), DEFAULT_COMMIT_RULES);
});
