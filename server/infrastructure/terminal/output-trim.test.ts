import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanOutput, trimOutput } from './output-trim';

test('colors, progress redraws and repeated lines are removed', () => {
  const lines = cleanOutput('\u001b[31mFAIL\u001b[0m a.test\r\nprogress 10%\rprogress 100%\nsame\nsame\nsame\nsame\nend\n');
  assert.deepEqual(lines, ['FAIL a.test', 'progress 100%', 'same', '[previous line repeated 3 more times]', 'end']);
});

test('short output is kept whole', () => {
  assert.deepEqual(trimOutput('a\nb\nc', 100, () => 'cut'), { text: 'a\nb\nc', omittedLines: 0 });
});

test('long output keeps the start and, mostly, the end with a marker between', () => {
  const text = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
  const result = trimOutput(text, 400, n => `[omitted ${n}]`);
  const lines = result.text.split('\n');
  assert.equal(lines[0], 'line 0');
  assert.equal(lines.at(-1), 'line 999');
  assert.ok(result.text.length <= 450);
  assert.ok(result.omittedLines > 900);
  assert.ok(lines.includes(`[omitted ${result.omittedLines}]`));
  const tail = lines.slice(lines.indexOf(`[omitted ${result.omittedLines}]`) + 1).length;
  const head = lines.indexOf(`[omitted ${result.omittedLines}]`);
  assert.ok(tail > head);
});
