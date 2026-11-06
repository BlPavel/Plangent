import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('section settings: project text beats group and global, built-in applies without items, skills do not mix between sections, plan works as before', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-section-settings-'));
  const cwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../../core-services').then(() => import('../../core/projects'));
  const library = await import('../../core-services').then(() => import('../../core/library/index'));
  const files = await import('../../core-services').then(() => import('../../core/library/library-manager'));
  const { syncItem } = await import('../../core-services').then(() => import('../../core/library/syncer'));
  const settings = await import('../../core-services').then(() => import('../../core/library/section-settings'));
  const { MATERIAL_KINDS } = await import('../../core-services').then(() => import('../../core/preparation/materials/kinds'));
  const { resolvePlanTemplate, DEFAULT_PLAN_TEMPLATE } = await import('../../core-services').then(() => import('../../core/library/plan-template'));
  const { planReviewSkills } = await import('../../core-services').then(() => import('../../core/library/plan-review-skill'));
  try {
    const group = createProject({ name: 'Group', kind: 'group' });
    const project = createProject({ name: 'Project', repo_path: path.join(root, 'project'), group_id: group.id });
    assert.equal(settings.resolveMaterialTemplate('architecture', project.id), MATERIAL_KINDS.architecture.defaultTemplate);
    assert.equal(settings.resolveMaterialReviewInstruction('qa'), MATERIAL_KINDS.qa.defaultReviewInstruction);
    assert.match(MATERIAL_KINDS.qa.protocol, /submit_material/);
    assert.match(MATERIAL_KINDS.architecture.protocol, /\*\*D1\*\*/);
    assert.match(MATERIAL_KINDS.qa.protocol, /\*\*Q1\*\*/);

    const make = (type: Parameters<typeof library.createLibraryItem>[0]['type'], title: string, scope: 'global' | 'project', targets: string[] = []) => {
      const item = library.createLibraryItem({ type, slug: title.toLowerCase().replace(/\W+/g, '-'), title, scope, targets });
      files.writeItemContent(item, title); syncItem(item); return item;
    };
    make('architecture-template', 'Global', 'global');
    assert.equal(settings.resolveMaterialTemplate('architecture', project.id), 'Global');
    make('architecture-template', 'Group', 'project', [group.id]);
    assert.equal(settings.resolveMaterialTemplate('architecture', project.id), 'Group');
    make('architecture-template', 'Direct', 'project', [project.id]);
    assert.equal(settings.resolveMaterialTemplate('architecture', project.id), 'Direct');
    assert.equal(settings.resolveMaterialTemplate('qa', project.id), MATERIAL_KINDS.qa.defaultTemplate);

    make('qa-review-instruction', 'QA rules', 'global');
    assert.equal(settings.resolveMaterialReviewInstruction('qa'), 'QA rules');
    assert.equal(settings.resolveMaterialReviewInstruction('architecture'), MATERIAL_KINDS.architecture.defaultReviewInstruction);

    const qaSkill = make('qa-review-skill', 'QA domain', 'project', [project.id]);
    const archSkill = make('architecture-review-skill', 'Boundaries', 'project', [group.id]);
    assert.deepEqual(settings.materialReviewSkills('qa', project.id).map(s => s.title), ['QA domain']);
    assert.deepEqual(settings.materialReviewSkills('architecture', project.id).map(s => s.title), ['Boundaries']);
    assert.deepEqual(planReviewSkills(project.id), []);
    // A skill of another section is never chosen, even by id.
    assert.equal(settings.resolveMaterialReviewSkill('qa', project.id, archSkill.id)!.id, qaSkill.id);
    assert.equal(settings.resolveMaterialReviewSkill('architecture', project.id, qaSkill.id)!.id, archSkill.id);

    // Plan keeps its own behavior; material items never leak into the plan template.
    assert.equal(resolvePlanTemplate(project.id), DEFAULT_PLAN_TEMPLATE);
    const plan = make('plan-template', 'Plan', 'project', [project.id]);
    assert.equal(resolvePlanTemplate(project.id), 'Plan');
    // A saved empty template switches the built-in text off.
    files.writeItemContent(plan, '');
    assert.equal(resolvePlanTemplate(project.id), '');
    // Service-only types never touch agent directories.
    assert.equal(fs.existsSync(path.join(project.repo_path, '.claude')), false);
  } finally {
    getDb().close();
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
