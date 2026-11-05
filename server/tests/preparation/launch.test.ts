import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('task agent launch returns sessions for each purpose without legacy run records', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-launch-'));
  process.env.PLANGENT_DATA_DIR = root;
  const { getDb } = await import('../../infrastructure/db/schema');
  const agents = await import('../../core-services').then(() => import('../../core/agents'));
  const { createProject } = await import('../../core-services').then(() => import('../../core/projects'));
  const { createTask, updateTask } = await import('../../core-services').then(() => import('../../core/tasks'));
  const { launchTaskAgent } = await import('../../core-services').then(() => import('../../core/preparation/launch'));
  const { createPlan } = await import('../../core-services').then(() => import('../../core/preparation/plans'));
  const { deletePlanFile } = await import('../../core-services').then(() => import('../../core/preparation/plan-file'));
  const { killProcessTree } = await import('../../infrastructure/terminal/process-tree');
  agents.initSessions();
  agents.configureSessionHost({ mcp: () => [], terminate: killProcessTree });
  const agent = agents.createAgent({ name: 'Mock', command: process.execPath, acp_command: process.execPath,
    acp_args: [path.resolve('server/tests/support/mock-acp-agent.mjs')] });
  const project = createProject({ name: 'Launch', repo_path: root, default_agent_id: agent.id });
  const task = createTask({ project_id: project.id, key: 'LAUNCH' });
  createPlan({ task_id: task.id, content: '- [ ] First' });
  try {
    for (const purpose of ['analysis', 'plan', 'architecture', 'qa', 'execute', 'preflight'] as const) {
      const result = await launchTaskAgent(project.id, task.id, { purpose, mode: 'discuss', config: { effort: 'low' } });
      assert.ok(result.session_id);
      assert.equal('run' in result, false);
      const session = agents.getSession(result.session_id);
      assert.equal(session.role, purpose === 'analysis' ? 'analyst' : purpose === 'plan' ? 'planner'
        : purpose === 'architecture' || purpose === 'qa' ? 'material-author' : 'executor');
      if (purpose === 'architecture' || purpose === 'qa') assert.equal(session.metadata.material_type, purpose);
      const deadline = Date.now() + 10_000;
      while (['starting', 'thinking'].includes(agents.getSession(session.id).status)) {
        if (Date.now() > deadline) throw new Error('Agent did not become idle');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    assert.equal(getDb().prepare("SELECT 1 FROM sqlite_master WHERE name='runs'").get(), undefined);
    assert.ok(!(getDb().pragma('table_info(agent_sessions)') as { name: string }[]).some(c => c.name === 'run_id'));
    await assert.rejects(launchTaskAgent('wrong', task.id, {}), /Project not found/);
    await assert.rejects(launchTaskAgent(project.id, 'wrong', {}), /Task not found/);
    updateTask(task.id, { status: 'done' });
    await assert.rejects(launchTaskAgent(project.id, task.id, {}), /только для чтения/);
  } finally { await agents.shutdownSessions(); deletePlanFile(task, root); getDb().close(); fs.rmSync(root, { recursive: true, force: true }); }
});
