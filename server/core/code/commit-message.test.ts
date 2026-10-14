import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleCommitMessage, cleanCommitMessage, validateCommitMessage, inspectCommitMessage } from './commit-message';
import { defaultGitSettings } from '../projects/git-settings';

test('assembly strips embedded trailers, optionally adds only explicit human coauthors and body', () => {
  const input = { title: 'TASK-1: fix', body: 'Details\n\nCo-Authored-By: Claude <noreply@anthropic.com>', coauthors: [{ name: 'Ivan', email: 'ivan@x' }] };
  assert.equal(assembleCommitMessage(input), 'TASK-1: fix');
  assert.equal(assembleCommitMessage({ ...input, includeDescription: true }), 'TASK-1: fix\n\nDetails');
  assert.equal(assembleCommitMessage({ ...input, includeCoauthors: true, includeDescription: true }), 'TASK-1: fix\n\nDetails\n\nCo-authored-by: Ivan <ivan@x>');
  assert.throws(() => assembleCommitMessage({ title: 'fix\nInjected' }));
  assert.throws(() => assembleCommitMessage({ title: 'fix', includeCoauthors: true, coauthors: [{ name: 'Claude\nInjected', email: 'x@y' }] }));
});
test('clean generated text removes attribution, complete matching lines and trailing blank lines', () => {
  const message = 'Fix\n\nDescription\nCo-authored-by: Human <a@b>\nGenerated with [Claude Code](link)\nRobot noreply@anthropic.com\n\n';
  assert.equal(cleanCommitMessage(message, defaultGitSettings), 'Fix\n\nDescription');
  assert.equal(cleanCommitMessage('Fix\n\u{1f916} Generated with something', defaultGitSettings), 'Fix');
  assert.equal(validateCommitMessage('Fix\nGENERATED WITH Claude Code', defaultGitSettings)[0].line, 2);
  assert.equal(validateCommitMessage('Fix', { ...defaultGitSettings, commit_pattern: '^TASK-\\d+:' })[0].kind, 'format');
  assert.equal(validateCommitMessage('Fix\nTASK-12: body', { ...defaultGitSettings, commit_pattern: '^TASK-\\d+:' })[0].kind, 'format');
  assert.equal(validateCommitMessage('TASK-12: Fix', { ...defaultGitSettings, commit_pattern: '^TASK-\\d+:' }).length, 0);
  assert.equal(validateCommitMessage('Fix\nCo-authored-by: Claude <a@b>', defaultGitSettings)[0].kind, 'forbidden');
});

test('manual inspection highlights forbidden embedded trailers before assembly', () => {
  const input = { title: 'Fix', includeDescription: true, body: 'Details\nCo-Authored-By: Claude <robot@anthropic.com>' };
  const result = inspectCommitMessage(input, defaultGitSettings);
  assert.ok(result.violations.some(v => v.kind === 'forbidden' && v.line === 4));
  assert.equal(result.cleaned, 'Fix\n\nDetails');
  assert.equal(inspectCommitMessage({ ...input, includeDescription: false }, defaultGitSettings).violations.length, 0);
});
