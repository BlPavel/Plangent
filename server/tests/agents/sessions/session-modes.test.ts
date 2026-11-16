import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectSessionMode } from '../../../core/agents/sessions/session-modes';

test('execution selects workspace writes for Codex and the ordinary mode for Claude', () => {
  const codex = ['read-only', 'workspace-write', 'danger-full-access'];
  const claude = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
  for (const policy of ['allow-all', 'allow-edits'] as const) {
    assert.equal(selectSessionMode(codex, policy), 'workspace-write');
    assert.equal(selectSessionMode(claude, policy), 'default');
  }
  assert.equal(selectSessionMode(codex, 'ask'), 'read-only');
  assert.equal(selectSessionMode(codex, 'read-only'), 'read-only');
  assert.equal(selectSessionMode(claude, 'read-only'), 'plan');
  assert.equal(selectSessionMode(codex, 'allow-all', 'discuss'), 'read-only');
  assert.equal(selectSessionMode(codex, 'allow-all', 'read-only'), 'read-only');
  assert.equal(selectSessionMode(claude, 'allow-edits', 'acceptEdits'), 'acceptEdits');
  assert.equal(selectSessionMode(codex, 'allow-all', 'danger-full-access'), 'workspace-write');
  assert.equal(selectSessionMode(['danger-full-access'], 'allow-all'), undefined);
  assert.equal(selectSessionMode([], 'allow-all'), undefined);
});

test('code fixers with editing permission ignore inherited read-only probe modes', () => {
  const modes = ['read-only', 'workspace-write', 'agent-full-access'];
  for (const policy of ['allow-edits', 'allow-all'] as const) {
    for (const preferred of ['read-only', 'discuss', 'plan'])
      assert.equal(selectSessionMode(modes, policy, preferred, true, 'code-fixer'), 'workspace-write');
  }
  assert.equal(selectSessionMode(modes, 'read-only', 'read-only', true, 'code-fixer'), 'read-only');
  assert.equal(selectSessionMode(modes, 'ask', 'read-only', false, 'code-fixer'), 'read-only');
  assert.equal(selectSessionMode(modes, 'allow-edits', 'read-only', false, 'chat'), 'read-only');
});

test('ACP applies the execution mode on start, after discussion and after restoring a session', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-modes-'));
  process.env.PLANGENT_DATA_DIR = temp;
  const { getDb } = await import('../../../infrastructure/db/schema');
  const sessions = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const { createAgentSession } = await import('../../../core/agents');
  const host = await import('../../../core-services').then(() => import('../../../core/agents/sessions/acp-host'));
  const { createAgent } = await import('../../../core-services').then(() => import('../../../core/agents/catalog'));
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { killProcessTree } = await import('../../../infrastructure/terminal/process-tree');
  sessions.initSessions();
  host.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const project = createProject({ name: 'Modes', repo_path: temp });
  try {
    for (const configOnly of [false, true]) {
      const agent = createAgent({ name: `Codex mock ${configOnly ? 'config' : 'modes'}`, command: process.execPath, acp_command: process.execPath,
        acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs'), '--codex-modes', '--inspect-mode', ...(configOnly ? ['--config-only'] : [])] });
      const session = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'executor', policy: 'allow-all' });
      const mode = () => (sessions.getSession(session.id).metadata.configOptions as { currentValue: string }[])[0].currentValue;
      await host.startSession(session.id);
      assert.equal(mode(), 'workspace-write');
      await host.closeSession(session.id);
      await host.startSession(session.id);
      assert.equal(mode(), 'workspace-write');
      await host.sendPrompt(session.id, [{ type: 'text', text: 'inspect' }]);
      const deadline = Date.now() + 5000;
      while (!sessions.history(session.id).some(e => e.type === 'turn_end')) {
        if (Date.now() > deadline) throw new Error('Prompt timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(sessions.history(session.id).find(e => e.type === 'assistant')?.payload.text, 'workspace-write');
      const fixer = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'code-fixer', policy: 'allow-edits', metadata: { preferredMode: 'read-only' } });
      const fixerMode = () => (sessions.getSession(fixer.id).metadata.configOptions as { currentValue: string }[])[0].currentValue;
      await host.startSession(fixer.id);
      assert.equal(fixerMode(), 'workspace-write', 'editing permission wins over the hidden read-only preference');
      await host.closeSession(fixer.id);
      await host.startSession(fixer.id);
      assert.equal(fixerMode(), 'workspace-write', 'restoring an old session also repairs the mode');
      for (const role of ['chat', 'errand'] as const) {
        const chat = createAgentSession({ project_id: project.id, agent_id: agent.id, role, policy: 'allow-all', mode: '' });
        assert.equal(chat.metadata.preferredMode, undefined, 'automatic mode is not an explicit preference');
        const chatMode = () => (sessions.getSession(chat.id).metadata.configOptions as { currentValue: string }[])[0].currentValue;
        await host.startSession(chat.id);
        assert.equal(chatMode(), 'workspace-write', role + ' automatically permits native file edits');
        await host.setMode(chat.id, 'read-only');
        await host.closeSession(chat.id);
        await host.startSession(chat.id);
        assert.equal(chatMode(), 'read-only', role + ' keeps an explicit read-only choice after restart');
        await host.closeSession(chat.id);
      }
      const discussion = sessions.createSession({ project_id: project.id, agent_id: agent.id, role: 'executor', policy: 'read-only', metadata: { preferredMode: 'discuss' } });
      await host.startSession(discussion.id);
      await host.enableExecution(discussion.id, 'allow-all');
      assert.equal(sessions.getSession(discussion.id).metadata.preferredMode, 'workspace-write');
      await host.closeSession(discussion.id);
      await host.startSession(discussion.id);
      assert.equal((sessions.getSession(discussion.id).metadata.configOptions as { currentValue: string }[])[0].currentValue, 'workspace-write');
    }
  } finally {
    await host.shutdownSessions();
    getDb().close();
  }
});
