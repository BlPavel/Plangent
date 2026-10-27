import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('plan review skills inherit by level, resolve safely, support proposals and never sync', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-plan-skill-'));
  const cwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const library = await import('./index');
  const files = await import('./library-manager');
  const { syncItem, unsyncItem } = await import('./syncer');
  const { planReviewSkills, resolvePlanReviewSkill, DEFAULT_PLAN_REVIEW_SKILL } = await import('./plan-review-skill');
  const sessions = await import('../agent-sessions/sessions');
  const { proposeLibraryChange, applyProposal } = await import('./proposals');
  sessions.initSessions();
  try {
    const group = createProject({ name: 'Group', kind: 'group' });
    const project = createProject({ name: 'Project', repo_path: path.join(root, 'project'), group_id: group.id });
    const other = createProject({ name: 'Other', repo_path: path.join(root, 'other') });
    assert.equal(resolvePlanReviewSkill(project.id).content, DEFAULT_PLAN_REVIEW_SKILL);
    const global = library.createLibraryItem({ type: 'plan-review-skill', slug: 'global-plan', title: 'Global', scope: 'global' });
    const shared = library.createLibraryItem({ type: 'plan-review-skill', slug: 'group-plan', title: 'Group', scope: 'project', targets: [group.id] });
    const direct = library.createLibraryItem({ type: 'plan-review-skill', slug: 'project-plan', title: 'Project', scope: 'project', targets: [project.id] });
    for (const item of [global, shared, direct]) { files.writeItemContent(item, item.title); syncItem(item); unsyncItem(item); }
    assert.deepEqual(planReviewSkills(project.id).map(item => item.origin), ['direct', 'group', 'global']);
    assert.equal(resolvePlanReviewSkill(project.id).content, 'Project');
    assert.equal(resolvePlanReviewSkill(project.id, shared.id).content, 'Group');
    assert.equal(resolvePlanReviewSkill(other.id, direct.id).content, 'Global');
    library.updateLibraryItem(direct.id, { enabled: false });
    assert.equal(resolvePlanReviewSkill(project.id, direct.id).id, shared.id);
    library.setExcluded(shared.id, project.id, true);
    assert.equal(resolvePlanReviewSkill(project.id).id, global.id);
    const session = sessions.createSession({ project_id: project.id, agent_id: 'agent-claude', role: 'librarian', policy: 'read-only' });
    const proposal = proposeLibraryChange(session.id, { action: 'create', type: 'plan-review-skill', slug: 'proposed-plan', title: 'Proposed', content: 'Check dependencies.', explanation: 'Plan checks' });
    const applied = applyProposal(proposal.id);
    assert.equal(files.readItemContent(applied), 'Check dependencies.');
    // Syncing service-only types must not touch any agent directories.
    assert.equal(fs.existsSync(path.join(project.repo_path, '.claude')), false);
    assert.equal(fs.existsSync(path.join(project.repo_path, '.agents')), false);
    for (const item of [global, shared, applied]) library.updateLibraryItem(item.id, { enabled: false });
    assert.equal(resolvePlanReviewSkill(project.id).id, null);
    assert.equal(resolvePlanReviewSkill(project.id).content, DEFAULT_PLAN_REVIEW_SKILL);
  } finally { getDb().close(); process.chdir(cwd); }
});
