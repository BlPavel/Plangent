import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('agent API centralizes selection, preferences, turn listeners and tool failures', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-agent-api-'));
  process.env.PLANGENT_DATA_DIR = temp;
  const api = await import('../../core-services').then(() => import('../../core/agents/index'));
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../../core-services').then(() => import('../../core/projects'));
  const { saveGlobalGitSettings } = await import('../../core-services').then(() => import('../../core/settings'));
  const { sessionSignals } = await import('../../core-services').then(() => import('../../core/agents/sessions/acp-host'));
  const { callTool } = await import('../../core-services').then(() => import('../../api/mcp/server'));
  try {
    api.initSessions();
    const agents = ['project', 'purpose', 'saved', 'explicit'].map(name => api.createAgent({ name }));
    const project = createProject({ name: 'Test', repo_path: temp, default_agent_id: agents[0].id });
    saveGlobalGitSettings({ git_agent_id: agents[1].id });
    assert.equal(api.selectAgent(project.id)?.id, agents[0].id);
    assert.equal(api.selectAgent(project.id, { purpose: 'git' })?.id, agents[1].id);
    assert.equal(api.selectAgent(project.id, { saved: agents[2].id, purpose: 'git' })?.id, agents[2].id);
    assert.equal(api.selectAgent(project.id, { explicit: agents[3].id, saved: agents[2].id, purpose: 'git' })?.id, agents[3].id);
    assert.equal(api.selectAgent(project.id, { explicit: 'missing' }), null);
    const session = api.createAgentSession({ project_id: project.id, agent_id: agents[0].id, role: 'executor', policy: 'allow-all',
      mode: 'discuss', config: { effort: 'high' } });
    assert.equal(session.metadata.preferredMode, 'discuss');
    assert.deepEqual(session.metadata.preferredConfig, { effort: 'high' });
    const count = sessionSignals.listenerCount('turn_end');
    const turn = api.waitForAgentTurn(session.id, 1000);
    const other = api.createAgentSession({ project_id: project.id, agent_id: agents[0].id, role: 'chat', policy: 'ask' });
    sessionSignals.emit('turn_end', other.id);
    assert.equal(sessionSignals.listenerCount('turn_end'), count + 1);
    sessionSignals.emit('turn_end', session.id);
    assert.equal((await turn.result).id, session.id);
    assert.equal(sessionSignals.listenerCount('turn_end'), count);
    const failed = api.waitForAgentTurn(session.id, 1000);
    sessionSignals.emit('error-state', session.id, 'delivery failed');
    await assert.rejects(failed.result, /delivery failed/);
    assert.equal(sessionSignals.listenerCount('turn_end'), count);
    api.updateSession(session.id, { status: 'thinking' });
    await assert.rejects(callTool(session.id, 'report_progress', { note: '' }), /Invalid note/);
    const invalid = await callTool(session.id, 'get_step_context', {});
    assert.equal('isError' in invalid && invalid.isError, true);
    const progress = await callTool(session.id, 'report_progress', { note: 'working' });
    assert.deepEqual(JSON.parse(progress.content[0].text), { ok: true });
    assert.equal(api.history(session.id).at(-1)?.type, 'report_progress');
    await assert.rejects(callTool(session.id, 'submit_plan', { content: 'bad' }), /not allowed/);
    const completion = await callTool(session.id, 'complete_step', { summary: 'done' });
    assert.deepEqual(JSON.parse(completion.content[0].text), { ok: true });
    assert.equal(api.getSession(session.id).status, 'complete');
    await assert.rejects(callTool(session.id, 'report_progress', { note: 'late' }), /no active turn/);
  } finally { getDb().close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
