import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('plan review instruction applies from the nearest level, is never synced and replaces the old skills once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-plan-instruction-'));
  const cwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../projects');
  const library = await import('./index');
  const files = await import('./library-manager');
  const { syncItem, unsyncItem } = await import('./syncer');
  const { resolvePlanReviewInstruction, DEFAULT_PLAN_REVIEW_INSTRUCTION, migratePlanReviewSkills } = await import('./plan-review-instruction');
  try {
    const group = createProject({ name: 'Group', kind: 'group' });
    const project = createProject({ name: 'Project', repo_path: path.join(root, 'project'), group_id: group.id });
    const other = createProject({ name: 'Other', repo_path: path.join(root, 'other') });
    assert.match(DEFAULT_PLAN_REVIEW_INSTRUCTION, /^# Plan review/);
    assert.equal(resolvePlanReviewInstruction(project.id), DEFAULT_PLAN_REVIEW_INSTRUCTION);
    const global = library.createLibraryItem({ type: 'plan-review-instruction', slug: 'global-plan', title: 'Global', scope: 'global' });
    const shared = library.createLibraryItem({ type: 'plan-review-instruction', slug: 'group-plan', title: 'Group', scope: 'project', targets: [group.id] });
    const direct = library.createLibraryItem({ type: 'plan-review-instruction', slug: 'project-plan', title: 'Project', scope: 'project', targets: [project.id] });
    for (const item of [global, shared, direct]) { files.writeItemContent(item, item.title); syncItem(item); unsyncItem(item); }
    assert.equal(resolvePlanReviewInstruction(project.id), 'Project');
    assert.equal(resolvePlanReviewInstruction(other.id), 'Global');
    library.updateLibraryItem(direct.id, { enabled: false });
    assert.equal(resolvePlanReviewInstruction(project.id), 'Group');
    library.setExcluded(shared.id, project.id, true);
    assert.equal(resolvePlanReviewInstruction(project.id), 'Global');
    // Service-only types never touch agent directories.
    assert.equal(fs.existsSync(path.join(project.repo_path, '.claude')), false);
    assert.equal(fs.existsSync(path.join(project.repo_path, '.agents')), false);
    for (const item of [global, shared, direct]) library.updateLibraryItem(item.id, { enabled: false });
    assert.equal(resolvePlanReviewInstruction(project.id), DEFAULT_PLAN_REVIEW_INSTRUCTION);

    // Old skills: the first of a level becomes its instruction with the same text, the unedited preset and extras go.
    const db = getDb();
    let tick = 0;
    const legacy = (slug: string, title: string, scope: string, content: string) => {
      const id = 'legacy-' + slug;
      db.prepare("INSERT INTO library_items (id, type, slug, title, description, scope, project_id, frontmatter, agent_filter, enabled, created_at) VALUES (?, 'plan-review-skill', ?, ?, '', ?, NULL, '{}', '[]', 1, ?)").run(id, slug, title, scope, '2020-01-01 00:00:0' + tick++);
      const dir = path.join(root, 'data', 'library', 'plan-review-skills', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'PLAN_REVIEW_SKILL.md'), content);
      return id;
    };
    const preset = legacy('default', 'Стандартный', 'global', 'preset');
    const mine = legacy('mine', 'Моё', 'global', 'My rules');
    const extra = legacy('extra', 'Ещё', 'global', 'Extra');
    migratePlanReviewSkills();
    assert.equal(library.getLibraryItem(preset), null);
    assert.equal(library.getLibraryItem(extra), null);
    const migrated = library.getLibraryItem(mine)!;
    assert.equal(migrated.type, 'plan-review-instruction');
    assert.equal(files.readItemContent(migrated), 'My rules');
    assert.equal(fs.existsSync(path.join(root, 'data', 'library', 'plan-review-skills')), false);
    migratePlanReviewSkills();
    assert.equal(library.getLibraryItem(mine)!.type, 'plan-review-instruction');
  } finally { getDb().close(); process.chdir(cwd); }
});
