import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('text instructions are proposed with a fixed slug, defaults to global when global only, and stay single per level', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-text-proposals-'));
  const cwd = process.cwd();
  process.chdir(root);
  process.env.PLANGENT_DATA_DIR = path.join(root, 'data');
  const { initializeAgentPresets } = await import('../../core-services').then(() => import('../../core/agents/catalog/seed'));
  initializeAgentPresets();
  const { getDb } = await import('../../infrastructure/db/schema');
  const { createProject } = await import('../../core-services').then(() => import('../../core/projects'));
  const sessions = await import('../../core-services').then(() => import('../../core/agents/sessions/sessions'));
  const library = await import('../../core-services').then(() => import('../../core/library/index'));
  const files = await import('../../core-services').then(() => import('../../core/library/library-manager'));
  const proposals = await import('../../core-services').then(() => import('../../core/library/proposals'));
  const texts = await import('../../core-services').then(() => import('../../core/library/instruction-texts'));
  sessions.initSessions();
  try {
    const project = createProject({ name: 'Project', repo_path: path.join(root, 'project') });
    const session = sessions.createSession({ project_id: project.id, agent_id: 'agent-claude', role: 'librarian', policy: 'read-only' });
    const base = { action: 'create' as const, slug: 'x', title: 'Interview', content: 'Ask less', explanation: 'shorter' };

    const builtin = texts.instructionTextFor('interview-instruction', project.id);
    assert.equal(builtin.level, 'default');
    assert.equal(builtin.item_id, null);
    assert.equal(builtin.global_only, true);
    assert.ok(builtin.content.length > 0);

    // The slug is chosen by the server, whatever the agent sends; a global-only text goes global without being asked.
    const created = proposals.proposeLibraryChange(session.id, { ...base, type: 'interview-instruction', slug: 'whatever Slug' });
    assert.equal(created.slug, 'interview_instruction');
    assert.equal(created.scope, 'global');
    assert.deepEqual(created.targets, []);
    assert.throws(() => proposals.applyProposal(created.id, { scope: 'project', targets: [project.id] }), /global only/);
    const item = proposals.applyProposal(created.id);
    assert.equal(item.scope, 'global');
    assert.equal(files.readItemContent(library.getLibraryItem(item.id)!), 'Ask less');

    const inForce = texts.instructionTextFor('interview-instruction', project.id);
    assert.equal(inForce.level, 'global');
    assert.equal(inForce.item_id, item.id);
    assert.equal(inForce.content, 'Ask less');

    // Only one per level: a second create is refused, an update of the existing one goes through.
    const second = proposals.proposeLibraryChange(session.id, { ...base, type: 'interview-instruction', slug: 'x' });
    assert.throws(() => proposals.applyProposal(second.id), /already exists/);
    const update = proposals.proposeLibraryChange(session.id, { ...base, action: 'update', type: 'interview-instruction', slug: 'x', item_id: item.id, content: 'Ask even less' });
    assert.equal(update.slug, 'interview_instruction');
    proposals.applyProposal(update.id);
    assert.equal(texts.instructionTextFor('interview-instruction', project.id).content, 'Ask even less');

    // A guide may live at the project level.
    const guide = proposals.proposeLibraryChange(session.id, { ...base, type: 'instruction-guide', title: 'Guide' });
    assert.equal(guide.scope, 'project');
    assert.deepEqual(guide.targets, [project.id]);
    assert.equal(proposals.applyProposal(guide.id).slug, 'instruction_guide');
    assert.equal(texts.instructionTextFor('instruction-guide', project.id).level, 'direct');
  } finally {
    getDb().close();
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
