import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('active agent sessions allow user Git actions', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'plangent-git-busy-'));
  process.env.PLANGENT_DATA_DIR = path.join(folder, 'data');
  const { initializeAgentPresets } = await import('../../../core-services').then(() => import('../../../core/agents/catalog/seed'));
  initializeAgentPresets();
  const { getDb } = await import('../../../infrastructure/db/schema');
  const { createProject } = await import('../../../core-services').then(() => import('../../../core/projects'));
  const { initSessions, createSession, updateSession } = await import('../../../core-services').then(() => import('../../../core/agents/sessions/sessions'));
  const { assertRepositoryIdle } = await import('../../../core-services').then(() => import('../../../core/git/repo/git-busy'));
  const { stage, commit, createBranch, switchBranch } = await import('../../../core-services').then(() => import('../../../core/git/repo/git-write'));
  const { repositoryInfo } = await import('../../../infrastructure/git/read');
  const { defaultGitSettings } = await import('../../../core-services').then(() => import('../../../core/settings/git-settings'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  const db = getDb(); initSessions();
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Developer'); git('config', 'user.email', 'dev@test.invalid');
    const agent = db.prepare('SELECT id FROM agents LIMIT 1').get() as { id: string };
    const group = createProject({ kind: 'group', name: 'Group' });
    const project = createProject({ name: 'Git', repo_path: folder, group_id: group.id });
    for (const projectId of [project.id, group.id]) {
      const session = createSession({ project_id: projectId, agent_id: agent.id, role: 'chat', policy: 'allow-edits' });
      for (const status of ['starting', 'thinking', 'waiting'] as const) {
        updateSession(session.id, { status });
        assert.doesNotThrow(() => assertRepositoryIdle(project.id));
      }
    }
    await fs.writeFile(path.join(folder, 'a.txt'), 'content'); await stage(folder, ['a.txt'], { assertIdle: () => assertRepositoryIdle(project.id) });
    await commit(folder, { title: 'User commit' }, () => defaultGitSettings, { assertIdle: () => assertRepositoryIdle(project.id) });
    await createBranch(folder, 'feature/work', 'main', { assertIdle: () => assertRepositoryIdle(project.id) });
    await switchBranch(folder, 'main', { assertIdle: () => assertRepositoryIdle(project.id) });
    assert.equal((await repositoryInfo(folder))?.branch, 'main');
  } finally { db.close(); await fs.rm(folder, { recursive: true, force: true }); }
});
