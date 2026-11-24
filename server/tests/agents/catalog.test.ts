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
import { updateAgentCli, agentInstallPlan, agentCliStatus, installAgentCliForAgent, isCommandAvailable, managedNpmSpec } from '../../core/agents/catalog';
import { agentPresets } from '../../core/agents/catalog/presets';
import { agentCliPath, cliBinDirs } from '../../infrastructure/acp/cli-install';
import type { Agent } from '../../models';
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

test('OpenCode preset exposes its native ACP mode and npm install source', () => {
  const preset = agentPresets.opencode;
  assert.equal(preset.name, 'OpenCode');
  assert.equal(preset.acp_command, 'opencode');
  assert.deepEqual(preset.acp_args, ['acp']);
  assert.equal(preset.command, 'opencode');
  assert.equal(managedNpmSpec(preset.update_command), '@opencode/cli@latest');
  assert.equal(preset.layout_profile?.main?.file, 'AGENTS.md');
  assert.equal(preset.layout_profile?.skills?.dir, '.opencode/skills');
  assert.equal(preset.layout_profile?.commands?.dir, '.opencode/commands');
});

test('automatic install accepts only plain npm global commands', () => {
  assert.equal(managedNpmSpec('npm install -g @opencode/cli@latest'), '@opencode/cli@latest');
  assert.equal(managedNpmSpec('npm update -g @anthropic-ai/claude-code'), '@anthropic-ai/claude-code@latest');
  assert.equal(managedNpmSpec('npm install -g opencode-ai'), 'opencode-ai@latest');
  assert.equal(managedNpmSpec('npm install -g pkg@1.2.3'), 'pkg@1.2.3');
  assert.equal(managedNpmSpec('opencode upgrade'), null);
  assert.equal(managedNpmSpec('npm install -g pkg && echo hi'), null);
});

test('native agents get an install plan; npx adapters do not', () => {
  const native = { id: 'agent-opencode', acp_command: 'opencode', acp_args: ['acp'], command: 'opencode', update_command: 'npm install -g @opencode/cli@latest' };
  assert.deepEqual(agentInstallPlan(native), { package: '@opencode/cli', version: 'latest', bin: 'opencode', command: 'opencode' });
  const adapter = { id: 'agent-codex', acp_command: 'npx', acp_args: ['--yes', '@agentclientprotocol/codex-acp@2.7.0'], command: 'codex', update_command: 'npm install -g @openai/codex@latest' };
  assert.equal(agentInstallPlan(adapter), null);
  assert.equal(agentInstallPlan({ ...native, update_command: 'opencode upgrade' }), null);
});

test('managed CLI folders follow the npm layout of each platform', () => {
  const base = path.join(os.tmpdir(), 'agent-cli');
  assert.deepEqual(cliBinDirs('win32', base), [base, path.join(base, 'bin')]);
  assert.deepEqual(cliBinDirs('darwin', base), [path.join(base, 'bin')]);
  assert.deepEqual(cliBinDirs('linux', base), [path.join(base, 'bin')]);
  assert.equal(agentCliPath('/existing').split(path.delimiter).at(-1), '/existing');
});

test('command availability resolves PATH entries with platform extensions', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-cli-check-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, process.platform === 'win32' ? 'plangent-fake.cmd' : 'plangent-fake');
  await fs.writeFile(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(isCommandAvailable('plangent-fake', { PATH: dir, PATHEXT: '.CMD' }), true);
  assert.equal(isCommandAvailable('missing-command', { PATH: dir }), false);
  assert.equal(isCommandAvailable(file, { PATH: dir }), true);
});

test('a missing native CLI installs into Plangent data and becomes launchable', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent fake npm '));
  t.after(async () => { closeDb(); await fs.rm(fixture, { recursive: true, force: true }); });
  // The fake npm writes the same shim the real one would, so PATH lookup exercises the real layout.
  await fs.writeFile(path.join(fixture, 'fake-npm.cjs'), [
    "const fs = require('node:fs'), path = require('node:path');",
    "const args = process.argv.slice(2), index = args.indexOf('--prefix'), prefix = args[index + 1];",
    "fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });",
    "if (process.platform === 'win32') fs.writeFileSync(path.join(prefix, 'plangent-fake.cmd'), '@echo off\\r\\n');",
    "else fs.writeFileSync(path.join(prefix, 'bin', 'plangent-fake'), '#!/bin/sh\\nexit 0\\n', { mode: 0o755 });",
  ].join('\n'));
  if (process.platform === 'win32') {
    await fs.writeFile(path.join(fixture, 'npm.cmd'), '@echo off\r\nnode "%~dp0fake-npm.cjs" %*\r\n');
  } else {
    await fs.writeFile(path.join(fixture, 'npm'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-npm.cjs" "$@"\n', { mode: 0o755 });
  }
  const agent: Agent = {
    id: 'agent-fake-install', name: 'Fake', acp_command: 'plangent-fake', acp_args: [],
    env: { PATH: agentCliPath(`${fixture}${path.delimiter}${process.env.PATH ?? ''}`) },
    use_proxy: false, command: 'plangent-fake', update_command: 'npm install -g plangent-fake@latest',
    layout_profile: null, model: '', reasoning_effort: '', active: true, created_at: '',
  };
  assert.deepEqual((await agentCliStatus(agent)).installed, false);
  await installAgentCliForAgent(agent);
  const installed = await agentCliStatus(agent);
  assert.equal(installed.installed, true);
  assert.equal(installed.state, 'done');
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
