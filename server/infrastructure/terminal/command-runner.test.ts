import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, readCommandLog } from './command-runner';
import { configureSlotLimit, slotStatus } from './command-slots';

const node = (code: string) => `"${process.execPath}" -e "${code.replace(/"/g, '\\"')}"`;
const base = { cwd: process.cwd(), heavy: true, timeoutMs: 20000 };

test('reports exit code and output, and frees the slot', async () => {
  configureSlotLimit(() => 1);
  const ok = await runCommand({ ...base, owner: 's1', command: node('console.log(1+1)') });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.output.trim(), '2');
  const failed = await runCommand({ ...base, owner: 's1', command: node('console.error(\'boom\'); process.exit(3)') });
  assert.equal(failed.exitCode, 3);
  assert.match(failed.output, /boom/);
  assert.equal(slotStatus().running.length, 0);
});

test('long output is trimmed and the whole log stays readable by its session only', async () => {
  configureSlotLimit(() => 1);
  const result = await runCommand({ ...base, owner: 's1', maxChars: 500, command: node('for (let i = 0; i < 3000; i++) console.log(\'row \' + i); console.log(\'summary: 7 failed\')') });
  assert.ok(result.omittedLines > 0);
  assert.ok(result.output.length < 700);
  assert.match(result.output, /summary: 7 failed/);
  assert.match(result.output, new RegExp(`command_output id=${result.id}`));
  assert.equal(readCommandLog('s1', result.id, { grep: '^row 2999$' }).text.trim(), '3000: row 2999');
  assert.equal(readCommandLog('s1', result.id, { from: 2, count: 2 }).text, 'row 1\nrow 2\n');
  assert.throws(() => readCommandLog('s2', result.id), /No output/);
});

test('a heavy command waits for the slot; a light one does not', async () => {
  configureSlotLimit(() => 1);
  const long = runCommand({ ...base, owner: 's1', command: node('setTimeout(() => {}, 700)') });
  await new Promise(resolve => setTimeout(resolve, 150));
  const light = await runCommand({ ...base, owner: 's2', heavy: false, command: node('console.log(\'quick\')') });
  assert.equal(light.output.trim(), 'quick');
  assert.equal(light.waitedMs, 0);
  const queued = await runCommand({ ...base, owner: 's3', command: node('console.log(\'late\')') });
  assert.ok(queued.waitedMs > 200, String(queued.waitedMs));
  await long;
});

test('queue timeout, run timeout and cancellation are reported separately from exit codes', async () => {
  configureSlotLimit(() => 1);
  const holder = runCommand({ ...base, owner: 's1', command: node('setTimeout(() => {}, 1500)') });
  await new Promise(resolve => setTimeout(resolve, 100));
  const gaveUp = await runCommand({ ...base, owner: 's2', queueTimeoutMs: 100, command: node('1') });
  assert.equal(gaveUp.queueTimedOut, true);
  assert.equal(gaveUp.exitCode, null);
  await holder;
  const slow = await runCommand({ ...base, owner: 's1', timeoutMs: 300, command: node('setTimeout(() => {}, 20000)') });
  assert.equal(slow.timedOut, true);
  const controller = new AbortController();
  const running = runCommand({ ...base, owner: 's1', signal: controller.signal, command: node('setTimeout(() => {}, 20000)') });
  setTimeout(() => controller.abort(), 200);
  const stopped = await running;
  assert.equal(stopped.cancelled, true);
  assert.equal(slotStatus().running.length, 0);
});
