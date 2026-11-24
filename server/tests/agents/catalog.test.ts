import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { closeDb, getDb } from '../../infrastructure/db/schema';
import { createAgent, deleteAgent, getAgent, listAgents, updateAgent } from '../../infrastructure/db/repositories/agents/catalog';
import { readOptions, writeOptions } from '../../infrastructure/db/repositories/agents/options';
import { addEvent, createSession, getSession, history, initSessions } from '../../infrastructure/db/repositories/agents/sessions';
import { addAgentDeletion } from '../../infrastructure/db/migrations/017-agent-deletion';
import { updateAgentCli } from '../../core/agents/catalog';
import { agentPresets } from '../../core/agents/catalog/presets';
import { agentCliPath } from '../../infrastructure/acp/cli-install';
import { DATA_DIR } from '../../infrastructure/paths';

test('GLM exposes 5.4 and 5.3 through distinct model roles', () => {
  const glm = agentPresets.glm;
  assert.equal(glm.acp_command, agentPresets.claude.acp_command);
  assert.equal(glm.env?.ANTHROPIC_MODEL, 'glm-5.4[1m]');
  assert.equal(glm.env?.ANTHROPIC_DEFAULT_OPUS_MODEL, 'glm-5.4[1m]');
  assert.equal(glm.env?.ANTHROPIC_DEFAULT_FABLE_MODEL, 'glm-5.4[1m]');
  assert.equal(glm.env?.ANTHROPIC_DEFAULT_SONNET_MODEL, 'glm-5.3[1m]');
  assert.equal(glm.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'glm-5.3[1m]');
});

test('macOS preset update installs and launches a CLI from Plangent data', { skip: process.platform !== 'darwin' }, async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'fake npm '));
  const originalPath = process.env.PATH;
  t.after(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    closeDb();
    await fs.rm(fixture, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(fixture, 'npm'), [
    '#!/bin/sh',
    'set -eu',
    'test "$1" = install',
    'test "$2" = --global',
    'test "$3" = --prefix',
    'test "$7" = @qwen-code/qwen-code@latest',
    'mkdir -p "$4/bin"',
    'printf "#!/bin/sh\\nprintf updated\\n" > "$4/bin/qwen"',
    'chmod +x "$4/bin/qwen"',
  ].join('\n'), { mode: 0o755 });
  process.env.PATH = agentCliPath(`${fixture}${path.delimiter}${originalPath ?? ''}`);
  const preset = agentPresets.qwen;
  const agent = createAgent({ name: preset.name, command: preset.command, acp_command: preset.acp_command,
    acp_args: preset.acp_args, update_command: preset.update_command });
  writeOptions(agent.id, '{}', Date.now());
  assert.deepEqual(await updateAgentCli(agent.id), { cli: { ok: true, output: '' }, adapter: null });
  assert.equal(readOptions(agent.id), undefined);
  await fs.access(path.join(DATA_DIR, 'agent-cli', 'bin', 'qwen'));
  const { stdout } = await promisify(execFile)('qwen', ['--acp']);
  assert.equal(stdout, 'updated');
});

test('deleting an agent after run removal clears project defaults and cached options', t => {
  t.after(closeDb);
  const db = getDb();
  const agent = createAgent({ name: 'Agent to delete' });
  const other = createAgent({ name: 'Agent to keep' });
  const insertProject = db.prepare('INSERT INTO projects (id, name, repo_path, default_agent_id) VALUES (?, ?, ?, ?)');
  insertProject.run('delete-project', 'Delete project', '/delete-project', agent.id);
  insertProject.run('keep-project', 'Keep project', '/keep-project', other.id);
  writeOptions(agent.id, '{}', Date.now());
  writeOptions(other.id, '{}', Date.now());
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'").get(), undefined);

  assert.equal(deleteAgent(agent.id), true);
  assert.equal(getAgent(agent.id), null);
  assert.deepEqual(db.prepare('SELECT default_agent_id FROM projects WHERE id=?').get('delete-project'), { default_agent_id: null });
  assert.equal(readOptions(agent.id), undefined);
  assert.ok(getAgent(other.id));
  assert.deepEqual(db.prepare('SELECT default_agent_id FROM projects WHERE id=?').get('keep-project'), { default_agent_id: other.id });
  assert.equal(readOptions(other.id), '{}');
  assert.equal(deleteAgent(agent.id), false);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('soft deletion preserves chats and history, hides the agent and allows a replacement with the same name', t => {
  t.after(closeDb);
  const db = getDb();
  initSessions();
  const agent = createAgent({ name: 'Agent with a chat' });
  db.prepare('INSERT INTO projects (id, name, repo_path, default_agent_id) VALUES (?, ?, ?, ?)')
    .run('chat-project', 'Chat project', '/chat-project', agent.id);
  const session = createSession({ project_id: 'chat-project', agent_id: agent.id, role: 'chat', policy: 'ask' });
  addEvent(session.id, 'assistant', { text: 'Saved response' });

  assert.equal(deleteAgent(agent.id), true);
  assert.equal(getAgent(agent.id), null);
  assert.equal(updateAgent(agent.id, { active: true }), null);
  assert.ok(!listAgents().some(item => item.id === agent.id));
  assert.ok(!listAgents(true).some(item => item.id === agent.id));
  assert.equal(getSession(session.id).agent_id, agent.id);
  assert.equal(getSession(session.id).metadata.deletedAgentName, agent.name);
  assert.equal(history(session.id)[0].payload.text, 'Saved response');
  assert.deepEqual(db.prepare('SELECT default_agent_id FROM projects WHERE id=?').get('chat-project'), { default_agent_id: null });
  assert.ok(db.prepare('SELECT deleted_at FROM agents WHERE id=?').get(agent.id));
  addAgentDeletion(db);
  addAgentDeletion(db);
  closeDb();
  assert.equal(getAgent(agent.id), null, 'deleted agents stay hidden after reopening the database');
  assert.equal(getSession(session.id).metadata.deletedAgentName, agent.name);
  const replacement = createAgent({ name: agent.name });
  assert.notEqual(replacement.id, agent.id);
  assert.equal(replacement.name, agent.name);
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);
});
