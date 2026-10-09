import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneratedMessage } from './generate-message';
import { defaultGitSettings } from '../projects/git-settings';
test('generated messages remove attribution and discard a disabled description', () => {
  const text = 'fix: limits\n\nExplain limits\nCo-Authored-By: Claude <noreply@anthropic.com>\nGenerated with [Claude Code]\n🤖 Generated with tool\n\n';
  assert.deepEqual(parseGeneratedMessage(text, true, defaultGitSettings), { title: 'fix: limits', body: 'Explain limits' });
  assert.deepEqual(parseGeneratedMessage(text, false, defaultGitSettings), { title: 'fix: limits', body: '' });
  assert.deepEqual(parseGeneratedMessage('fix\nCustom credit: robot', true, { forbidden_patterns: ['^Custom credit:'] }), { title: 'fix', body: '' });
  assert.throws(() => parseGeneratedMessage('Generated with Claude Code', true, defaultGitSettings));
});
