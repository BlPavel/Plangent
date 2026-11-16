import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRepository } from '../../support/git';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-review-cleanup-'));
process.env.PLANGENT_DATA_DIR = path.join(temporary, 'data');

test('finishing a review removes worktrees that are dirty and worktrees of earlier commits', async t => {
  const originalCwd = process.cwd();
  process.chdir(temporary);
  const { initializeAgentPresets, initSessions } = await import('../../../core-services').then(() => import('../../../core/agents'));
  const { getDb } = await import('../../../infrastructure/db/schema');
  const review = await import('../../../core/review/branch');
  const { ensureReviewWorktree } = await import('../../../core/git');
  initializeAgentPresets();
  initSessions();
  const { root, git, dispose } = createTestRepository();
  t.after(() => { getDb().close(); process.chdir(originalCwd); dispose(); fs.rmSync(temporary, { recursive: true, force: true }); });
  git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, 'code.txt'), 'base');
  git('add', '.'); git('commit', '-m', 'Fixture base');
  git('switch', '-c', 'feature');
  fs.writeFileSync(path.join(root, 'code.txt'), 'first');
  git('add', '.'); git('commit', '-m', 'First');
  const first = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(root, 'code.txt'), 'second');
  git('add', '.'); git('commit', '-m', 'Second');
  const second = git('rev-parse', 'HEAD').trim();
  getDb().prepare("INSERT INTO projects(id,kind,name,key,repo_path) VALUES ('q','project','Q','q',?)").run(root);
  const id = await review.ensureReview('q', 'refs/heads/feature', 'refs/heads/main');
  // The author pushed after the first round: the review has a worktree for each commit, and both are dirty.
  const old = await ensureReviewWorktree(root, id, first), current = await ensureReviewWorktree(root, id, second);
  fs.writeFileSync(path.join(old, 'code.txt'), 'edited');
  fs.writeFileSync(path.join(current, 'left-by-agent.txt'), 'untracked');
  fs.unlinkSync(path.join(current, 'code.txt'));
  await review.finishThreads('q', id);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(current), false);
  assert.equal(git('worktree', 'list').includes('plangent-reviews'), false);
});
