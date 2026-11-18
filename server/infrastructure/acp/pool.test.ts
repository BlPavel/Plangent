import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { AdapterPool, supportsSharedProcess, type AdapterLease } from './pool';
import type * as ACP from './types';

const launch = { command: process.execPath, args: [path.resolve('server/tests/support/mock-shared-acp-agent.mjs')],
  env: process.env, version: 'test', shared: true };
const where = (name: string) => ({ cwd: path.join(os.tmpdir(), name), mcpServers: [] });
function observer() {
  const events: ACP.SessionNotification[] = [], permissions: string[] = [], failures: string[] = [];
  return { events, permissions, failures, callbacks: {
    update: (event: ACP.SessionNotification) => { events.push(event); },
    permission: async (request: ACP.RequestPermissionRequest): Promise<ACP.RequestPermissionResponse> => {
      permissions.push(request.sessionId);
      return { outcome: { outcome: 'selected', optionId: 'yes' } };
    },
    failed: (reason: string) => { failures.push(reason); },
  } };
}
const prompt = (lease: AdapterLease, sessionId: string, text: string) => lease.connection.prompt({ sessionId, prompt: [{ type: 'text', text }] });

test('only pinned known adapter families are eligible', () => {
  for (const spec of ['codex-acp@2.1.1', 'codex-acp@2.7.0', 'claude-agent-acp@0.85.1', 'claude-agent-acp@0.108.0'])
    assert.ok(supportsSharedProcess('npx', ['--yes', '@agentclientprotocol/' + spec]));
  for (const spec of ['codex-acp@2.0.0', 'codex-acp@latest', 'codex-acp@3.0.0', 'unknown@2.7.0'])
    assert.equal(supportsSharedProcess('npx', ['--yes', '@agentclientprotocol/' + spec]), false);
  assert.equal(supportsSharedProcess('custom', ['--yes', '@agentclientprotocol/codex-acp@2.7.0']), false);
});

test('concurrent chats share one handshake/process and route events, modes, permissions, cancellation and close independently', async () => {
  const pool = new AdapterPool(), a = observer(), b = observer();
  const leases = await Promise.all([pool.acquire(launch, a.callbacks), pool.acquire(launch, b.callbacks)]);
  const [first, second] = leases;
  try {
    assert.equal(first.process.pid, second.process.pid);
    const [one, two] = await Promise.all([first.connection.newSession(where('one')), second.connection.newSession(where('two'))]);
    assert.notEqual(one.sessionId, two.sessionId);
    assert.equal(a.events.length, 1, 'updates before session/new response are retained');
    await first.connection.setMode({ sessionId: one.sessionId, modeId: 'read-only' });
    await Promise.all([prompt(first, one.sessionId, 'permission'), prompt(second, two.sessionId, 'permission')]);
    assert.deepEqual(a.permissions, [one.sessionId]);
    assert.deepEqual(b.permissions, [two.sessionId]);
    assert.ok(a.events.every(e => e.sessionId === one.sessionId));
    assert.ok(b.events.every(e => e.sessionId === two.sessionId));
    assert.match(JSON.stringify(a.events), /read-only/);
    assert.doesNotMatch(JSON.stringify(b.events), /read-only/);
    const held = prompt(first, one.sessionId, 'hold');
    await prompt(second, two.sessionId, 'still responsive');
    await first.connection.cancel({ sessionId: one.sessionId });
    assert.equal((await held).stopReason, 'cancelled');
    await first.release();
    await prompt(second, two.sessionId, 'survived close');
    assert.deepEqual(b.failures, []);
    const resumed = await pool.acquire(launch, a.callbacks);
    leases.push(resumed);
    assert.equal(resumed.process.pid, second.process.pid);
    await resumed.connection.loadSession({ sessionId: one.sessionId, ...where('one') });
    assert.match(JSON.stringify(a.events.at(-1)), /replay/);
    await resumed.release();
    await second.release();
    assert.notEqual(second.process.exitCode, null, 'last release waits for process shutdown');
  } finally { await Promise.all(leases.map(lease => lease.release())); }
});

test('environment, launch arguments, unknown launchers and missing close capability keep processes separate', async () => {
  const pool = new AdapterPool(), leases: AdapterLease[] = [];
  try {
    for (const config of [launch, { ...launch, env: { ...process.env, MOCK_ACCOUNT: 'different' } },
      { ...launch, args: [...launch.args, '--different'] }, { ...launch, shared: false }])
      leases.push(await pool.acquire(config, observer().callbacks));
    assert.equal(new Set(leases.map(l => l.process.pid)).size, 4);
    const unsupported = { ...launch, env: { ...process.env, MOCK_NO_CLOSE: '1' } };
    const pair = await Promise.all([pool.acquire(unsupported, observer().callbacks), pool.acquire(unsupported, observer().callbacks)]);
    leases.push(...pair);
    assert.notEqual(pair[0].process.pid, pair[1].process.pid);
  } finally { await Promise.all(leases.map(l => l.release())); }
});

test('a failed session start leaves siblings working; process death reports all owners and next acquire starts fresh', async () => {
  const pool = new AdapterPool(), a = observer(), b = observer();
  const first = await pool.acquire(launch, a.callbacks), second = await pool.acquire(launch, b.callbacks);
  const leases = [first, second];
  try {
    const one = await first.connection.newSession(where('one'));
    await assert.rejects(second.connection.newSession(where('fail')));
    await second.release();
    await prompt(first, one.sessionId, 'survived');
    const third = await pool.acquire(launch, b.callbacks);
    leases.push(third);
    await third.connection.newSession(where('three'));
    await assert.rejects(prompt(first, one.sessionId, 'crash'));
    await new Promise<void>(resolve => first.process.exitCode !== null ? resolve() : first.process.once('exit', () => resolve()));
    assert.equal(a.failures.length, 1);
    assert.equal(b.failures.length, 1);
    const replacement = await pool.acquire(launch, observer().callbacks);
    leases.push(replacement);
    assert.notEqual(replacement.process.pid, first.process.pid);
  } finally { await Promise.all(leases.map(l => l.release())); }
});

test('a failed close drains the process without killing a sibling or admitting new chats', async () => {
  const pool = new AdapterPool(), config = { ...launch, env: { ...process.env, MOCK_FAIL_CLOSE: '1' } };
  const first = await pool.acquire(config, observer().callbacks), second = await pool.acquire(config, observer().callbacks);
  const leases = [first, second];
  try {
    await first.connection.newSession(where('one'));
    const two = await second.connection.newSession(where('two'));
    await first.release();
    await prompt(second, two.sessionId, 'survived');
    const third = await pool.acquire(config, observer().callbacks);
    leases.push(third);
    assert.notEqual(third.process.pid, second.process.pid);
  } finally { await Promise.all(leases.map(l => l.release())); }
});
