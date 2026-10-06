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

test('fuzzy: file name match beats directory match, non-subsequences are dropped', () => {
  const files = ['server/core/code/search.ts', 'client/src/search/other.ts', 'README.md', 'src/App.vue']
  const hits = fuzzyFiles(files, 'search.ts').map(h => h.path)
  assert.equal(hits[0], 'server/core/code/search.ts')
  assert.ok(!fuzzyFiles(files, 'zzz').length)
  assert.equal(fuzzyFiles(files, 'app')[0].path, 'src/App.vue')
  assert.equal(fuzzyFiles(files, '').length, 4)
})

test('in-file find: case, whole word, regex, invalid regex', () => {
  const text = 'Foo foo food'
  const run = options => findInLine(text, findPattern({ query: 'foo', ...options }).pattern).map(r => r.start)
  assert.equal(run({}).join(), '0,4,8')
  assert.equal(run({ caseSensitive: true }).join(), '4,8')
  assert.equal(run({ wholeWord: true }).join(), '0,4')
  assert.equal(findInLine(text, findPattern({ query: 'fo+', regex: true }).pattern).length, 3)
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
