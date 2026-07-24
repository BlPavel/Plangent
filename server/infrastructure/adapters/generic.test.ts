import assert from 'node:assert/strict';
import test from 'node:test';
import { shellUtf8Command, shouldInjectPromptViaPty } from './generic';

test('Windows agent shells explicitly use UTF-8 for PTY input', () => {
  const command = shellUtf8Command('win32');

  assert.match(command ?? '', /InputEncoding/);
  assert.match(command ?? '', /OutputEncoding/);
  assert.match(command ?? '', /UTF8Encoding/);
  assert.equal(shellUtf8Command('linux'), null);
});

test('normal queue prompts are passed as argv on Windows', () => {
  const prompt = [
    '# Задача: PL-123 — исправить очередь',
    '## Your assigned steps for this session',
    'Выполнить только p1 и p2.',
  ].join('\n');

  assert.equal(
    shouldInjectPromptViaPty(prompt, 'codex', ['--dangerously-bypass-approvals-and-sandbox'], 'win32'),
    false,
  );
});

test('oversized Windows prompts use readiness-aware PTY injection', () => {
  assert.equal(shouldInjectPromptViaPty('x'.repeat(30_000), 'codex', [], 'win32'), true);
});

test('escaped quotes are included in the Windows command-length guard', () => {
  assert.equal(shouldInjectPromptViaPty('"'.repeat(13_000), 'codex', [], 'win32'), true);
});

test('non-Windows prompts keep using argv regardless of size', () => {
  assert.equal(shouldInjectPromptViaPty('x'.repeat(30_000), 'codex', [], 'linux'), false);
});
