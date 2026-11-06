import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('MR review: a global instruction with a built-in text applies to every review, skills are optional and come on top', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-mr-instruction-'));
  const cwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../../core-services').then(() => import('../../core/projects'));
  const library = await import('../../core-services').then(() => import('../../core/library/index'));
  const files = await import('../../core-services').then(() => import('../../core/library/library-manager'));
  const { syncItem } = await import('../../core-services').then(() => import('../../core/library/syncer'));
  const { resolveMrReviewInstruction, DEFAULT_MR_REVIEW_INSTRUCTION } = await import('../../core-services').then(() => import('../../core/library/mr-review-instruction'));
  const { resolveReviewSkill } = await import('../../core-services').then(() => import('../../core/library/review-skill'));
  const texts = await import('../../core-services').then(() => import('../../core/library/instruction-texts'));
  try {
    const project = createProject({ name: 'Project', repo_path: path.join(root, 'project') });
    assert.match(DEFAULT_MR_REVIEW_INSTRUCTION, /^# Merge request review/);
    assert.equal(resolveMrReviewInstruction(), DEFAULT_MR_REVIEW_INSTRUCTION);
    // No skill is no longer replaced by a "standard" one: the instruction works alone.
    assert.equal(resolveReviewSkill(project.id, null), null);
    assert.ok(texts.isTextInstructionType('mr-review-instruction'));
    assert.equal(texts.isGlobalOnlyType('mr-review-instruction'), true);
    assert.equal(texts.instructionTextFor('mr-review-instruction', project.id).level, 'default');

    const instruction = library.createLibraryItem({ type: 'mr-review-instruction', slug: 'mr_review_instruction', title: 'Ревью МР', scope: 'global' });
    files.writeItemContent(instruction, 'Only check security');
    syncItem(instruction);
    assert.equal(resolveMrReviewInstruction(), 'Only check security');
    assert.equal(texts.instructionTextFor('mr-review-instruction', project.id).content, 'Only check security');
    // It is a text for the app, never written into an agent's folders.
    assert.ok(!fs.existsSync(path.join(project.repo_path, '.claude')));

    const skill = library.createLibraryItem({ type: 'review-skill', slug: 'project-focus', title: 'Focus', scope: 'project', targets: [project.id] });
    files.writeItemContent(skill, 'Mind the module boundaries');
    assert.equal(resolveReviewSkill(project.id, null)?.content, 'Mind the module boundaries');
  } finally {
    getDb().close();
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
