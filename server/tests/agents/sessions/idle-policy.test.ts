import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHAT_IDLE_MS, COMPLETED_WORK_IDLE_MS } from '../../../core/agents/sessions/idle-policy';

test('idle processes stop after the turn, resume with load, and restart unsupported adapters with a notice', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-idle-'));
  process.env.PLANGENT_DATA_DIR = temp;
  const api = await import('../../../core-services').then(() => import('../../../core/agents/index'));
  const host = await import('../../../core-services').then(() => import('../../../core/agents/sessions/acp-host'));
  const { getDb } = await import('../../../infrastructure/db/schema');
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { killProcessTree } = await import('../../../infrastructure/terminal/process-tree');
  const { enqueue, editQueued } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/prompt-queue'));
  api.initSessions();
  const terminated: number[] = [];
  host.configureSessionHost({ mcp: () => [], terminate: async pid => { if (pid) terminated.push(pid); await killProcessTree(pid); } });
  const project = createProject({ name: 'Idle test', repo_path: temp });
  async function until(check: () => boolean) {
    const deadline = Date.now() + 10_000;
    while (!check()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  try {
    for (const load of [true, false]) {
      const agent = api.createAgent({ name: 'Idle ' + load, command: process.execPath, acp_command: process.execPath,
        acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs'), ...(!load ? ['--no-load'] : [])] });
      const session = api.createAgentSession({ project_id: project.id, agent_id: agent.id, role: 'executor', policy: 'ask' });
      const pid = (await host.startSession(session.id)).process.pid!;
      await api.runAgentWork(session.id, [{ type: 'text', text: 'first' }]);
      api.markAgentWorkFinished(session.id);
      host.stopIdleSessions(Date.now() + CHAT_IDLE_MS);
      assert.equal(terminated.includes(pid), false, 'an active turn cannot be stopped');
      await until(() => api.history(session.id).some(e => e.type === 'turn_end'));
      await new Promise(resolve => setImmediate(resolve));
      host.stopIdleSessions(Date.now() + COMPLETED_WORK_IDLE_MS - 1000);
      assert.equal(terminated.includes(pid), false);
      const queued = enqueue(session.id, JSON.stringify([{ type: 'text', text: 'queued' }]));
      host.stopIdleSessions(Date.now() + COMPLETED_WORK_IDLE_MS + 100);
      assert.equal(terminated.includes(pid), false, 'queued messages prevent stopping');
      editQueued(session.id, queued.id);
      host.stopIdleSessions(Date.now() + 2 * COMPLETED_WORK_IDLE_MS + 200);
      await until(() => terminated.includes(pid));
      await api.runAgentWork(session.id, [{ type: 'text', text: 'continue' }]);
      await until(() => api.history(session.id).filter(e => e.type === 'turn_end').length === 2);
      assert.equal(api.history(session.id).some(e => e.type === 'notice' && e.payload.text === 'Агент перезапущен без прежнего разговора'), !load);
      assert.notEqual((await host.startSession(session.id)).process.pid, pid);
      const resumedPid = (await host.startSession(session.id)).process.pid!;
      await api.runAgentWork(session.id, [{ type: 'text', text: 'permission' }]);
      await until(() => host.snapshot(session.id).permissions.length === 1);
      host.stopIdleSessions(Date.now() + CHAT_IDLE_MS);
      assert.equal(terminated.includes(resumedPid), false, 'permission waiting prevents stopping');
      host.answerPermission(session.id, host.snapshot(session.id).permissions[0].permissionId, 'yes');
      await until(() => api.history(session.id).filter(e => e.type === 'turn_end').length === 3);
      if (!load) {
        api.deleteSession(session.id);
        host.stopIdleSessions();
        await until(() => terminated.includes(resumedPid));
      } else await host.closeSession(session.id);
    }
  } finally { await host.shutdownSessions(); getDb().close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
