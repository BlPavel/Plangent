import '../../../core-services';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '../../support/database';
import { createCodeReviewRepository } from '../../../infrastructure/db/repositories/review/code/service-repository';
import { createReviewService } from '../../../core/review/code/reviews';
import { pendingItems } from '../../../core/review/code/rounds';
import type { AgentSession } from '../../../core/agents';

test('items close in every state, retain queued replies and stay closed after late agent replies', async () => {
  const db = createTestDatabase();
  const records = createCodeReviewRepository(db);
  const { store } = records;
  db.prepare("INSERT INTO projects(id,name,repo_path,kind) VALUES ('project','Review',?,'project')").run(process.cwd());
  const service = createReviewService(records, { repository: async () => null });
  const review = store.createReview({ project_id: 'project', branch: null, head_commit: '', head_start: '', origin: 'project', origin_id: 'project' });
  const round = store.createRound({ review_id: review.id, snapshot_tree: '', session_id: 'session' });
  const session = { id: 'session', project_id: 'project', role: 'code-fixer' } as AgentSession;
  try {
    for (const status of ['draft', 'sent', 'done', 'answered', 'needs_decision'] as const) {
      const item = store.createItem({ review_id: review.id, scope: 'general', kind: 'fix', text: 'Fix it', status, round_id: status === 'draft' ? null : round.id });
      if (status === 'answered') store.createMessage({ item_id: item.id, author: 'developer', kind: 'text', text: 'Unsent reply' });
      assert.equal((await service.closeItem('project', review.id, item.id, 'answered')).closed, true, status);
      assert.equal(pendingItems(store, review.id).some(candidate => candidate.id === item.id), false, status);
      if (status === 'answered') {
        assert.equal(store.listMessages(review.id, item.id)[0].text, 'Unsent reply');
        await service.closeItem('project', review.id, item.id, 'reopen');
        assert.equal(pendingItems(store, review.id).some(candidate => candidate.id === item.id), true);
        await service.closeItem('project', review.id, item.id, 'answered');
      }
      if (status === 'sent') {
        assert.equal((await service.getAgentReview(session)).assigned.some((candidate: { id: string }) => candidate.id === item.id), false);
        assert.throws(() => service.focusItem(session, item.id), /not waiting/);
        const updated = await service.replyItem(session, item.id, { kind: 'change', text: 'Finished before close' });
        assert.equal(updated.closed, true, 'a late reply must not reopen a closed item');
        assert.equal(store.listMessages(review.id, item.id).at(-1)?.text, 'Finished before close');
      }
      assert.equal((await service.current('project')).items.find(candidate => candidate.id === item.id)?.closed, true);
    }
  } finally { db.close(); }
});
test('requesting implementation persistently converts a question into a fix, while discussion does not', async () => {
  const db = createTestDatabase();
  const records = createCodeReviewRepository(db);
  const { store } = records;
  db.prepare("INSERT INTO projects(id,name,repo_path,kind) VALUES ('project','Review',?,'project')").run(process.cwd());
  const service = createReviewService(records, { repository: async () => null });
  const review = store.createReview({ project_id: 'project', branch: null, head_commit: '', head_start: '', origin: 'project', origin_id: 'project' });
  const item = store.createItem({ review_id: review.id, scope: 'general', kind: 'question', text: 'Why?', status: 'answered' });
  try {
    await service.addMessage('project', review.id, item.id, { kind: 'text', text: 'Explain more' });
    assert.equal(store.getItem(item.id)?.kind, 'question');
    await assert.rejects(service.addMessage('project', review.id, item.id, { kind: 'implement', text: ' ' }), /text required/);
    assert.equal(store.getItem(item.id)?.kind, 'question', 'failed requests leave the question intact');
    await service.closeItem('project', review.id, item.id, 'answered');
    const message = await service.addMessage('project', review.id, item.id, { kind: 'implement', text: 'Apply the discussed solution' });
    assert.equal(message.kind, 'implement');
    const saved = createCodeReviewRepository(db).store.getItem(item.id)!;
    assert.equal(saved.kind, 'fix');
    assert.equal(saved.closed, false);
    assert.equal(saved.text, 'Why?', 'the original question and thread remain in history');
    await service.addMessage('project', review.id, item.id, { kind: 'text', text: 'More details' });
    assert.equal(store.getItem(item.id)?.kind, 'fix', 'later discussion does not turn the fix back into a question');
  } finally { db.close(); }
});
test('returning an accepted card restores developer attention without queuing new agent work', async () => {
  const db = createTestDatabase();
  const records = createCodeReviewRepository(db);
  const { store } = records;
  db.prepare("INSERT INTO projects(id,name,repo_path,kind) VALUES ('project','Review',?,'project')").run(process.cwd());
  const service = createReviewService(records, { repository: async () => null });
  const review = store.createReview({ project_id: 'project', branch: null, head_commit: '', head_start: '', origin: 'project', origin_id: 'project' });
  const item = store.createItem({ review_id: review.id, scope: 'general', kind: 'fix', text: 'Fix it', status: 'done', answer: 'Completed' });
  try {
    await service.closeItem('project', review.id, item.id, 'accept');
    assert.equal((await service.current('project')).attention, 0);
    const reopened = await service.closeItem('project', review.id, item.id, 'reopen');
    assert.equal(reopened.closed, false);
    assert.equal(reopened.status, 'done');
    assert.equal(reopened.answer, 'Completed');
    assert.equal((await service.current('project')).attention, 1);
    assert.equal(pendingItems(store, review.id).length, 0, 'the developer decides whether to send another request');
    await service.closeItem('project', review.id, item.id, 'accept');
    assert.equal((await service.current('project')).attention, 0);
  } finally { db.close(); }
});