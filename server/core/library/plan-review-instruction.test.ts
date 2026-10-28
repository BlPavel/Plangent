import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('plan review: the global instruction is general, project and group skills are chosen on top, none is synced, old levels become skills once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-plan-instruction-'));
  const cwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const library = await import('./index');
  const files = await import('./library-manager');
  const { syncItem, unsyncItem } = await import('./syncer');
  const { resolvePlanReviewInstruction, DEFAULT_PLAN_REVIEW_INSTRUCTION, migratePlanReviewInstructionLevels } = await import('./plan-review-instruction');
  const { planReviewSkills, resolvePlanReviewSkill } = await import('./plan-review-skill');
  try {
    const group = createProject({ name: 'Group', kind: 'group' });
    const project = createProject({ name: 'Project', repo_path: path.join(root, 'project'), group_id: group.id });
    const other = createProject({ name: 'Other', repo_path: path.join(root, 'other') });
    assert.match(DEFAULT_PLAN_REVIEW_INSTRUCTION, /^# Plan review/);
    assert.equal(resolvePlanReviewInstruction(), DEFAULT_PLAN_REVIEW_INSTRUCTION);
    assert.equal(resolvePlanReviewSkill(project.id), null);

    const instruction = library.createLibraryItem({ type: 'plan-review-instruction', slug: 'global-plan', title: 'Global', scope: 'global' });
    const shared = library.createLibraryItem({ type: 'plan-review-skill', slug: 'group-skill', title: 'Group', scope: 'project', targets: [group.id] });
    const direct = library.createLibraryItem({ type: 'plan-review-skill', slug: 'project-skill', title: 'Project', scope: 'project', targets: [project.id] });
    for (const item of [instruction, shared, direct]) { files.writeItemContent(item, item.title); syncItem(item); unsyncItem(item); }
    assert.equal(resolvePlanReviewInstruction(), 'Global');
    // The project's own skill comes first; an unknown choice falls back to it.
    assert.deepEqual(planReviewSkills(project.id).map(s => s.title), ['Project', 'Group']);
    assert.equal(resolvePlanReviewSkill(project.id, shared.id)!.content, 'Group');
    assert.equal(resolvePlanReviewSkill(project.id, 'missing')!.content, 'Project');
    assert.equal(resolvePlanReviewSkill(other.id, direct.id), null);
    // Service-only types never touch agent directories.
    assert.equal(fs.existsSync(path.join(project.repo_path, '.claude')), false);
    assert.equal(fs.existsSync(path.join(project.repo_path, '.agents')), false);
    library.updateLibraryItem(direct.id, { enabled: false });
    assert.equal(resolvePlanReviewSkill(project.id)!.content, 'Group');
    library.updateLibraryItem(instruction.id, { enabled: false });
    assert.equal(resolvePlanReviewInstruction(), DEFAULT_PLAN_REVIEW_INSTRUCTION);

    // Project and group instruction texts of the previous design become skills with the same text.
    const old = library.createLibraryItem({ type: 'plan-review-instruction', slug: 'plan_review_instruction', title: 'Ревью плана', scope: 'project', targets: [other.id] });
    files.writeItemContent(old, 'Architecture rules');
    migratePlanReviewInstructionLevels();
    const moved = library.getLibraryItem(old.id)!;
    assert.equal(moved.type, 'plan-review-skill');
    assert.equal(files.readItemContent(moved), 'Architecture rules');
    assert.equal(resolvePlanReviewSkill(other.id)!.content, 'Architecture rules');
    migratePlanReviewInstructionLevels();
    assert.equal(library.getLibraryItem(old.id)!.type, 'plan-review-skill');
  } finally { getDb().close(); process.chdir(cwd); }
});
