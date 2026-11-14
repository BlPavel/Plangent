import '../../../core-services';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../../infrastructure/db/schema';
for (const existing of [false, true]) {
  test('review migration and storage: ' + (existing ? 'existing database' : 'fresh database'), async () => {
    const { createReviewStore } = await import('../../../infrastructure/db/repositories/review/code');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    try {
      if (existing) {
        migrate(db);
        // Simulate an installation predating review storage while retaining real project/task data.
        db.exec(`DROP TABLE code_review_file_view; DROP TABLE code_review_item;
          DROP TABLE code_review_round; DROP TABLE code_review;
          INSERT INTO projects(id,name,repo_path) VALUES ('project','Existing','/existing');
          INSERT INTO tasks(id,project_id,key,title) VALUES ('task','project','T-1','Keep me');`);
      }
      migrate(db);
      if (!existing) {
        db.exec("INSERT INTO projects(id,name,repo_path) VALUES ('project','Existing','/existing')");
      }
      db.exec("INSERT INTO projects(id,name,repo_path) VALUES ('other','Other','/other')");
      const store = createReviewStore(db);
      const input = { project_id: 'project', branch: 'main', head_start: 'head-a',
        origin: 'project' as const, origin_id: 'project' };
      const review = store.createReview(input);
      assert.equal(review.status, 'open');
      assert.equal(review.closed_at, null);
      assert.equal(store.getOpenReview('project', 'main')?.id, review.id);
      assert.throws(() => store.createReview(input), /UNIQUE/);
      const other = store.createReview({ ...input, project_id: 'other', origin_id: 'other' });
      const taskReview = store.createReview({ ...input, branch: 'task-branch', origin: 'task', origin_id: 'task' });
      assert.equal(taskReview.origin, 'task');
      assert.equal(taskReview.origin_id, 'task');
      assert.equal(store.listReviews('project').length, 2);
      const detached = store.createReview({ ...input, branch: null, head_commit: 'head-a' });
      assert.throws(() => store.createReview({ ...input, branch: null, head_commit: 'head-a' }), /UNIQUE/);
      assert.throws(() => store.createReview({ ...input, branch: null }), /CHECK/);
      assert.equal(store.getOpenReview('project', null, 'head-a')?.id, detached.id);
      store.createReview({ ...input, branch: null, head_commit: 'head-b' });

      const round = store.createRound({ review_id: review.id, snapshot_tree: 'tree-a', session_id: 'session-a' });
      assert.equal(round.n, 1);
      const nextRound = store.createRound({ review_id: review.id, snapshot_tree: 'tree-b' });
      assert.equal(nextRound.n, 2);
      assert.equal(store.updateRound(nextRound.id, { session_id: 'session-b' })?.session_id, 'session-b');
      const foreignRound = store.createRound({ review_id: other.id, snapshot_tree: 'other-tree' });
      assert.throws(() => db.prepare('INSERT INTO code_review_round(id,review_id,n,snapshot_tree) VALUES (?,?,?,?)')
        .run('duplicate',review.id,1,'tree'), /UNIQUE/);
      assert.throws(() => store.createRound({ review_id: 'missing', snapshot_tree: 'tree' }), /FOREIGN KEY/);

      const draft = store.createItem({ review_id: review.id, scope: 'line', file: 'src/app.ts',
        line_start: 2, line_end: 4, side: 'old', kind: 'fix', text: '**Fix this**',
        refs: ['analysis/file.md'], code_snippet: 'const x = 1;' });
      assert.equal(draft.author, 'developer');
      assert.equal(draft.status, 'draft');
      assert.equal(draft.round_id, null);
      assert.equal(draft.outdated, false);
      assert.deepEqual(store.getItem(draft.id)?.refs, ['analysis/file.md']);
      assert.equal(store.listItems(review.id, null).length, 1);
      assert.throws(() => store.updateItem(draft.id, { round_id: foreignRound.id }), /FOREIGN KEY/);
      assert.equal(store.getItem(draft.id)?.round_id, null);
      store.updateItem(draft.id, { round_id: round.id, status: 'sent' });
      assert.equal(store.listItems(review.id, null).length, 0);
      assert.equal(store.listItems(review.id, round.id).length, 1);
      assert.deepEqual(store.listRounds(review.id).map(r => r.n), [1,2]);
      for (const status of ['done','answered','needs_decision','rejected','sent'] as const) {
        assert.equal(store.updateItem(draft.id, { status, answer: 'Explanation', outdated: true })?.status, status);
      }
      assert.equal(store.getItem(draft.id)?.answer, 'Explanation');
      assert.equal(store.getItem(draft.id)?.outdated, true);
      const carried = store.createItem({ review_id: review.id, scope: 'general', kind: 'question',
        text: 'Follow-up?', carried_from_item_id: draft.id });
      assert.equal(carried.carried_from_item_id, draft.id);
      assert.throws(() => store.updateItem(carried.id, { carried_from_item_id: carried.id }), /itself/);
      assert.throws(() => store.createItem({ review_id: other.id, scope: 'general', kind: 'question',
        text: '?', carried_from_item_id: draft.id }), /same review/);
      const fileItem = store.createItem({ review_id: review.id, scope: 'file', file: 'src/app.ts',
        kind: 'fix', text: 'File remark', round_id: nextRound.id, status: 'sent' });
      assert.throws(() => store.updateItem(fileItem.id, { line_start: 1 }), /CHECK/);
      assert.throws(() => store.createItem({ review_id: review.id, scope: 'line', kind: 'fix', text: 'Missing location' }), /CHECK/);
      assert.throws(() => store.updateItem(draft.id, { line_end: 1 }), /CHECK/);
      assert.throws(() => store.updateItem(draft.id, { refs: [42] as unknown as string[] }), /array of strings/);
      for (const [column, value] of [
        ['status','unknown'], ['author','unknown'], ['scope','unknown'], ['side','unknown'],
        ['kind','unknown'], ['refs','{}'], ['outdated',2],
      ] as const) {
        assert.throws(() => db.prepare('UPDATE code_review_item SET ' + column + '=? WHERE id=?').run(value,draft.id), /CHECK/);
      }
      assert.throws(() => db.prepare("UPDATE code_review SET status='unknown' WHERE id=?").run(review.id), /CHECK/);
      assert.throws(() => db.prepare("UPDATE code_review SET origin='unknown' WHERE id=?").run(review.id), /CHECK/);

      store.markFileViewed(review.id, 'src/app.ts', 'hash-a');
      assert.equal(store.isFileViewed(review.id, 'src/app.ts', 'hash-a'), true);
      assert.equal(store.isFileViewed(review.id, 'src/app.ts', 'hash-b'), false);
      store.markFileViewed(review.id, 'src/app.ts', 'hash-b');
      assert.equal(store.listFileViews(review.id).length, 1);
      assert.equal(store.isFileViewed(review.id, 'src/app.ts', 'hash-a'), false);
      assert.equal(store.listFileViews(review.id)[0].content_hash, 'hash-b');
      store.markFileViewed(review.id, 'temporary.ts', 'hash');
      assert.equal(store.deleteFileView(review.id, 'temporary.ts'), true);

      // Re-running startup migrations must preserve review content and existing application data.
      migrate(db);
      assert.equal(store.getReview(review.id)?.head_start, 'head-a');
      assert.equal(store.getItem(draft.id)?.text, '**Fix this**');
      assert.equal(store.getRound(round.id)?.snapshot_tree, 'tree-a');
      assert.equal(store.listFileViews(review.id).length, 1);
      if (existing) assert.deepEqual(db.prepare('SELECT key,title FROM tasks WHERE id=?').get('task'),
        { key: 'T-1', title: 'Keep me' });

      const closed = store.updateReview(review.id, { status: 'closed', head_end: 'head-end' })!;
      assert.ok(closed.closed_at);
      assert.equal(closed.head_end, 'head-end');
      assert.equal(store.getOpenReview('project', 'main'), null);
      const replacement = store.createReview(input);
      assert.throws(() => store.updateReview(review.id, { status: 'open' }), /UNIQUE/);
      assert.equal(store.getReview(review.id)?.status, 'closed');
      store.updateReview(replacement.id, { status: 'abandoned' });
      assert.ok(store.getReview(replacement.id)?.closed_at);
      assert.equal(store.updateReview(review.id, { status: 'open' })?.closed_at, null);
      assert.equal(store.listReviews('project', 'abandoned').length, 1);

      assert.equal(store.deleteRound(round.id), true);
      assert.equal(store.getItem(draft.id), null);
      assert.equal(store.getItem(carried.id)?.carried_from_item_id, null);
      assert.equal(store.getItem(fileItem.id)?.id, fileItem.id);
      assert.equal(store.deleteItem(carried.id), true);
      assert.equal(store.deleteReview(review.id), true);
      assert.equal(store.listRounds(review.id).length, 0);
      assert.equal(store.listItems(review.id).length, 0);
      assert.equal(store.listFileViews(review.id).length, 0);
      assert.ok(store.getReview(other.id));
      db.prepare('DELETE FROM projects WHERE id=?').run('project');
      assert.equal(store.listReviews('project').length, 0);
      assert.equal(store.updateReview('missing', {}), null);
      assert.equal(store.updateRound('missing', {}), null);
      assert.equal(store.updateItem('missing', {}), null);
      assert.deepEqual(db.pragma('foreign_key_check'), []);
    } finally { db.close(); }
  });
}
