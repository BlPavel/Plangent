import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelGitOperation, executeGitOperation } from './operation';

test('operation IDs are unique while active and cancellation belongs to the project', async () => {
  let finish!: () => void;
  let operationSignal!: AbortSignal;
  const pending = executeGitOperation({ projectId: 'one', root: '.', operationId: 'shared-id' }, async (_root, options) => {
    operationSignal = options.signal!;
    await new Promise<void>(resolve => { finish = resolve; });
    return 'done';
  });
  await assert.rejects(executeGitOperation({ projectId: 'two', root: '.', operationId: 'shared-id' }, async () => ''), /Invalid operation ID/);
  assert.throws(() => cancelGitOperation('two', 'shared-id'), /Operation not found/);
  assert.equal(operationSignal.aborted, false);
  cancelGitOperation('one', 'shared-id');
  assert.equal(operationSignal.aborted, true);
  finish();
  assert.deepEqual(await pending, { operationId: 'shared-id', output: 'done' });
  assert.throws(() => cancelGitOperation('one', 'shared-id'), /Operation not found/);
});

test('external cancellation is forwarded and failed operations release their ID', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(executeGitOperation({ projectId: 'one', root: '.', operationId: 'retry-id', signal: controller.signal }, async (_root, options) => {
    assert.equal(options.signal?.aborted, true);
    throw new Error('action failed');
  }), /action failed/);
  assert.deepEqual(await executeGitOperation({ projectId: 'one', root: '.', operationId: 'retry-id' }, async () => 'retried'), { operationId: 'retry-id', output: 'retried' });
});
