import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireSlot, configureSlotLimit, slotStatus, SlotTimeoutError, autoSlotLimit, slotLimit } from './command-slots';

test('automatic limit is used until a positive number is configured', () => {
  configureSlotLimit(() => 0);
  assert.equal(slotLimit(), autoSlotLimit());
  assert.ok(autoSlotLimit() >= 2);
  configureSlotLimit(() => 3);
  assert.equal(slotLimit(), 3);
  configureSlotLimit(() => Number('abc'));
  assert.equal(slotLimit(), autoSlotLimit());
});

test('commands beyond the limit wait in order and start when a slot is released', async () => {
  configureSlotLimit(() => 1);
  const first = await acquireSlot('a', 'one');
  const order: string[] = [];
  const second = acquireSlot('b', 'two').then(lease => { order.push('two'); return lease; });
  const third = acquireSlot('c', 'three').then(lease => { order.push('three'); return lease; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(order, []);
  assert.deepEqual(slotStatus().waiting.map(w => w.command), ['two', 'three']);
  first.release();
  first.release();
  const secondLease = await second;
  assert.deepEqual(order, ['two']);
  secondLease.release();
  (await third).release();
  assert.deepEqual(order, ['two', 'three']);
  assert.equal(slotStatus().running.length, 0);
});

test('waiting stops on timeout and on abort, without taking a slot', async () => {
  configureSlotLimit(() => 1);
  const held = await acquireSlot('a', 'held');
  await assert.rejects(acquireSlot('b', 'late', { timeoutMs: 20 }), SlotTimeoutError);
  const controller = new AbortController();
  const aborted = acquireSlot('c', 'aborted', { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted);
  assert.equal(slotStatus().waiting.length, 0);
  held.release();
  (await acquireSlot('d', 'free')).release();
});

test('raising the limit lets waiting commands in', async () => {
  configureSlotLimit(() => 1);
  const first = await acquireSlot('a', 'one');
  const second = acquireSlot('b', 'two');
  configureSlotLimit(() => 2);
  first.release();
  (await second).release();
});
