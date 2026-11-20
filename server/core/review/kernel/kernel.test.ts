import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReply, pendingThreads, awaitingReply, reviewTransition } from './index';

test('review variants restrict reply kinds and require nonempty text', () => {
  assert.deepEqual(parseReply({ kind: 'change', text: '  Fixed  ' }), { kind: 'change', text: 'Fixed' });
  for (const kind of ['change', 'disagree', 'toString'])
    assert.throws(() => parseReply({ kind, text: 'Reply' }, ['answer', 'options', 'questions']), /Invalid reply/);
  assert.throws(() => parseReply({ kind: 'answer', text: '  ' }), /Invalid reply/);
});

test('a batch includes fresh threads and queued developer replies, and only sent replies await an agent', () => {
  const threads = [
    { id: 'new', fresh: true, messages: [] },
    { id: 'queued', fresh: false, messages: [{ author: 'developer', sent: false }] },
    { id: 'sent', fresh: false, messages: [{ author: 'developer', sent: true }] },
    { id: 'answered', fresh: false, messages: [{ author: 'developer', sent: true }, { author: 'agent', sent: true }] },
  ];
  assert.deepEqual(pendingThreads(threads, t => t.messages, t => t.fresh).map(t => t.id), ['new', 'queued']);
  assert.deepEqual(threads.filter(t => awaitingReply(t.messages)).map(t => t.id), ['sent']);
});

test('a reported review cannot start again until its owner creates a new cycle', () => {
  const phases = { idle: '', running: 'running', reported: 'done' };
  const { review } = require('../../../../tests/fixtures/transitions.json') as {
    review: ({ current: string; event: 'start' | 'report' } & ({ expected: string } | { error: string }))[];
  };
  for (const row of review) {
    const transition = () => reviewTransition(row.current, row.event, phases);
    if ('error' in row) assert.throws(transition, { message: row.error, status: 409 });
    else assert.equal(transition(), row.expected, JSON.stringify(row));
  }
});
