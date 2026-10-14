import test from 'node:test';
import assert from 'node:assert/strict';
import { transition } from './state';
test('confirmation gates push, commits-only completion and revision', () => {
  const run = { stage: 'commits' as const, status: 'running' as const, scenario: 'push' as const };
  assert.throws(() => transition(run, 'accept'));
  assert.deepEqual(transition(run, 'commits_ready'), { stage: 'confirmation', status: 'waiting' });
  const confirmation = { ...run, ...transition(run, 'commits_ready') };
  assert.deepEqual(transition(confirmation, 'accept'), { stage: 'push', status: 'running' });
  assert.deepEqual(transition({ ...confirmation, scenario: 'commits' }, 'accept'), { stage: 'done', status: 'complete' });
  assert.deepEqual(transition(confirmation, 'revise'), { stage: 'commits', status: 'running' });
  assert.throws(() => transition({ ...confirmation, status: 'complete' }, 'revise'));
});
test('full cycle adds the MR stage after push; other scenarios finish at push', () => {
  const push = { stage: 'push' as const, status: 'running' as const };
  assert.deepEqual(transition({ ...push, scenario: 'full' }, 'push_done'), { stage: 'mr', status: 'running' });
  assert.deepEqual(transition({ ...push, scenario: 'push' }, 'push_done'), { stage: 'done', status: 'complete' });
  assert.deepEqual(transition({ stage: 'mr', status: 'running', scenario: 'full' }, 'mr_done'), { stage: 'done', status: 'complete' });
  assert.throws(() => transition({ ...push, scenario: 'full' }, 'mr_done'));
});
