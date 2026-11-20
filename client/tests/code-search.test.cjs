const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function moduleAt(file) {
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, { exports, require }, { filename: file })
  return exports
}
const { fuzzyFiles } = moduleAt('client/src/features/code/utils/fuzzy.ts')
const { findPattern, findInLine, markHtml } = moduleAt('client/src/shared/code-viewer/find.ts')

const files = ['server/core/code/search.ts', 'client/src/search/other.ts', 'README.md', 'src/App.vue']
for (const [query, expected] of [
  ['search.ts', ['server/core/code/search.ts', 'client/src/search/other.ts']],
  ['zzz', []],
  ['app', ['src/App.vue']],
  ['', files],
]) {
  test(`fuzzy file ranking for ${JSON.stringify(query)}`, () => {
    assert.deepEqual(Array.from(fuzzyFiles(files, query), hit => hit.path), expected)
  })
}

for (const [name, options, expected] of [
  ['literal', { query: 'foo' }, [[0, 3], [4, 7], [8, 11]]],
  ['case sensitive', { query: 'foo', caseSensitive: true }, [[4, 7], [8, 11]]],
  ['whole word', { query: 'foo', wholeWord: true }, [[0, 3], [4, 7]]],
  ['regex', { query: 'fo+', regex: true }, [[0, 3], [4, 7], [8, 11]]],
  ['no match', { query: 'missing' }, []],
]) {
  test(`line search: ${name}`, () => {
    const { pattern, error } = findPattern(options)
    assert.equal(error, undefined)
    assert.ok(pattern)
    assert.deepEqual(Array.from(findInLine('Foo foo food', pattern), ({ start, end }) => [start, end]), expected)
  })
}

test('line search rejects invalid regex and accepts empty input without a pattern', () => {
  assert.ok(findPattern({ query: '(', regex: true }).error)
  assert.equal(findPattern({ query: '' }).pattern, null)
})

test('markHtml keeps entities and tags intact across a match', () => {
  const html = '<span class="k">a&lt;b</span> c'
  // text: "a<b c"; match "<b c" = offsets 1..5
  assert.equal(markHtml(html, [{ start: 1, end: 5 }]),
    '<span class="k">a<mark class="cv-hit">&lt;b</mark></span><mark class="cv-hit"> c</mark>')
  assert.equal(markHtml('ab ab', [{ start: 0, end: 2 }, { start: 3, end: 5 }], 1),
    '<mark class="cv-hit">ab</mark> <mark class="cv-hit cv-hit-current">ab</mark>')
  assert.equal(markHtml('abab', [{ start: 0, end: 2 }, { start: 2, end: 4 }]),
    '<mark class="cv-hit">ab</mark><mark class="cv-hit">ab</mark>')
})

test('refs: only existing files and folders, deduplicated, punctuation trimmed', () => {
  const { extractRefs } = moduleAt('client/src/features/code/utils/refs.ts')
  const files = new Set(['src/a.ts', 'README.md'])
  const dirs = new Set(['src'])
  const refs = extractRefs('см. @src/a.ts, и @src/ тоже @src/a.ts @nope.ts @README.md.', files, dirs)
  assert.equal([...refs].join('|'), 'src/a.ts|src|README.md')
})
