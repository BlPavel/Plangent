const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { createPinia, setActivePinia } = require('pinia')

function moduleAt(file, mocks = {}, globals = {}) {
  const exports = {}
  const context = {
    exports, require: name => name in mocks ? mocks[name] : require(name),
    AbortController, TextDecoder, URLSearchParams, setTimeout, clearTimeout, ...globals,
  }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, context, { filename: file })
  return exports
}
const plain = value => JSON.parse(JSON.stringify(value))
function harness() {
  setActivePinia(createPinia())
  const handlers = new Set()
  const stops = []
  const events = {
    onServerEvent(handler) { handlers.add(handler); return () => handlers.delete(handler) },
    subscribeCodeProject(p) { return () => stops.push(p) },
  }
  let calls = 0
  const codeApi = {
    repository: async () => { calls++; return { head: 'head', branch: 'main' } },
    changes: async () => [], stats: async () => ({}), files: async () => ['a.ts'], tree: async () => [],
    file: async (p, path) => ({ path, kind: 'text', content: p }),
  }
  const codeReviewsApi = { current: async () => ({ review: null, items: [], rounds: [], other_reviews: [], file_views: [] }), attention: async () => [] }
  const store = moduleAt('client/src/features/code/stores/code.ts', {
    '@core/api/events': events, '../api': { codeApi, codeReviewsApi },
    '../utils/screen-state': moduleAt('client/src/features/code/utils/screen-state.ts'),
  }).useCodeStore()
  return { store, codeApi, codeReviewsApi, handlers, stops, calls: () => calls,
    emit: event => { for (const handler of handlers) handler(event) } }
}

test('watcher updates data automatically; stop unsubscribes and clears state', async () => {
  const h = harness()
  await h.store.start('p')
  const before = h.calls()
  h.emit({ type: 'code:changed', projectId: 'other' })
  h.emit({ type: 'code:changed', projectId: 'p' })
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(h.calls(), before + 1)
  assert.equal(h.store.head, 'head')
  h.store.stop()
  assert.deepEqual(h.stops, ['p'])
  assert.equal(h.handlers.size, 0)
  assert.equal(h.store.projectId, null)
})

test('late file response cannot overwrite a newer selection', async () => {
  const h = harness()
  await h.store.start('p')
  let resolveOld
  h.codeApi.file = async (p, path) => path === 'old' ? new Promise(resolve => { resolveOld = resolve }) : { path, kind: 'text' }
  const old = h.store.selectFile('old')
  await h.store.selectFile('new')
  resolveOld({ path: 'old', kind: 'text' })
  await old
  assert.equal(h.store.file.path, 'new')
  h.store.stop()
})

test('late project response cannot overwrite the new project', async () => {
  const h = harness()
  let resolveOld
  h.codeApi.repository = async p => p === 'old' ? new Promise(resolve => { resolveOld = resolve }) : { head: p, branch: p }
  const first = h.store.start('old')
  await h.store.start('new')
  resolveOld({ head: 'old', branch: 'old' })
  await first
  assert.equal(h.store.head, 'new')
  assert.equal(h.store.loading, false)
  h.store.stop()
})

test('stream decodes Unicode split across chunks and reports server errors', async () => {
  const encoder = new TextEncoder()
  const bytes = encoder.encode('{"type":"match","text":"Привет"}\n{"type":"done"}')
  let offset = 0
  let cancelled = false
  const reader = {
    async read() { return offset < bytes.length ? { value: bytes.slice(offset, ++offset), done: false } : { done: true } },
    async cancel() { cancelled = true }, releaseLock() {},
  }
  const api = moduleAt('client/src/core/api/index.ts', {}, {
    fetch: async () => ({ ok: true, body: { getReader: () => reader } }),
  }).api
  const result = []
  for await (const event of api.stream('/search')) result.push(event)
  assert.deepEqual(plain(result), [{ type: 'match', text: 'Привет' }, { type: 'done' }])
  assert.equal(cancelled, true)
  offset = 0
  const badReader = { async read() { return { value: encoder.encode('{"type":"error","error":"broken"}\n'), done: false } }, async cancel() {}, releaseLock() {} }
  const badApi = moduleAt('client/src/core/api/index.ts', {}, { fetch: async () => ({ ok: true, body: { getReader: () => badReader } }) }).api
  await assert.rejects(async () => { for await (const event of badApi.stream('/search')) void event }, /broken/)
})

test('search cancellation suppresses old results and incomplete streams produce an error', async () => {
  const h = harness()
  await h.store.start('p')
  let release
  let signal
  h.codeApi.search = async function* (p, options, s) {
    signal = s
    await new Promise(resolve => { release = resolve })
    yield { type: 'match', path: 'stale', line: 1, text: '' }
  }
  const pending = h.store.search({ query: 'old' })
  h.store.cancelSearch()
  release()
  await pending
  assert.equal(signal.aborted, true)
  assert.equal(h.store.matches.length, 0)
  h.codeApi.search = async function* () { yield { type: 'match', path: 'new', line: 1, text: '' } }
  await h.store.search({ query: 'new' })
  assert.match(h.store.searchError, /before completion/)
  h.store.stop()
})

test('WebSocket reconnect resubscribes; reference counts preserve remaining viewers', () => {
  const sockets = []
  const timers = []
  class Socket {
    static OPEN = 1
    readyState = 0
    sent = []
    constructor() { sockets.push(this) }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.onclose?.() }
    open() { this.readyState = 1; this.onopen() }
  }
  const events = moduleAt('client/src/core/api/events.ts', {}, {
    WebSocket: Socket, location: { protocol: 'https:', host: 'localhost' },
    setTimeout: fn => { timers.push(fn); return timers.length }, clearTimeout: () => {},
  })
  const stopHandler = events.onServerEvent(() => {})
  const stopA = events.subscribeCodeProject('p')
  const stopB = events.subscribeCodeProject('p')
  sockets[0].open()
  assert.deepEqual(sockets[0].sent, [{ type: 'code:subscribe', projectId: 'p' }])
  stopA()
  assert.equal(sockets[0].sent.length, 1)
  sockets[0].onclose()
  timers.shift()()
  sockets[1].open()
  assert.deepEqual(sockets[1].sent, [{ type: 'code:subscribe', projectId: 'p' }])
  stopB()
  assert.equal(sockets[1].sent[1].type, 'code:unsubscribe')
  stopHandler()
})

test('attention refreshes on review events and removes projects no longer tracked', async () => {
  setActivePinia(createPinia())
  let handler
  let data = [{ project_id: 'p', review_id: 'r', origin: 'task', origin_id: 'task', count: 1, items: [] }]
  const store = moduleAt('client/src/features/code/stores/attention.ts', {
    '@core/api/events': { onServerEvent: h => { handler = h; return () => {} } },
    '../api': { codeReviewsApi: { attention: async () => data } },
  }).useCodeAttentionStore()
  store.start(['p'])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(store.count, 1)
  assert.equal(store.forTask('task').length, 1)
  data = []
  handler({ type: 'code_review_updated', projectId: 'p' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(store.count, 0)
  store.start([])
  store.stop()
})


test('deleted selected file closes quietly during watcher refresh', async () => {
  const h = harness()
  await h.store.start('p')
  await h.store.selectFile('deleted.ts')
  h.codeApi.file = async () => { throw new Error('File not found') }
  await h.store.refresh()
  assert.equal(h.store.file, null)
  assert.equal(h.store.error, null)
  assert.equal(h.store.selectedPath, null)
  h.store.stop()
})

test('deleted file that still shows as a change stays open for its diff', async () => {
  const h = harness()
  await h.store.start('p')
  await h.store.selectFile('deleted.ts')
  h.codeApi.file = async () => { throw new Error('File not found') }
  h.codeApi.changes = async () => [{ path: 'deleted.ts', status: 'D' }]
  await h.store.refresh()
  assert.equal(h.store.error, null)
  assert.equal(h.store.selectedPath, 'deleted.ts')
  h.store.stop()
})

test('mutations update loaded history and deleting an opened review clears its detail', async () => {
  const h = harness()
  let reads = 0
  h.codeReviewsApi.history = async () => { reads++; return [] }
  h.codeReviewsApi.detail = async () => ({ review: { id: 'r' }, items: [] })
  h.codeReviewsApi.removeReview = async () => {}
  await h.store.start('p')
  await h.store.loadHistory()
  await h.store.openReview('r')
  await h.store.removeReview('r')
  assert.equal(h.store.openedReviewId, null)
  assert.equal(h.store.openedReview, null)
  assert.equal(reads, 2)
  h.store.stop()
})

test('diff model builds Diff rows and file stripes from the same hunks', () => {
  const m = moduleAt('client/src/shared/code-viewer/diff-model.ts')
  const lines = Array.from({ length: 30 }, (_, i) => 'l' + (i + 1))
  const diff = [
    'diff --git a/f b/f', '--- a/f', '+++ b/f',
    '@@ -2,5 +2,5 @@', ' l2', ' l3', '-old4', '+new4', ' l5', ' l6',
    '@@ -20,4 +20,3 @@', ' l20', '-gone', ' l21', ' l22', '\ No newline at end of file', '',
  ].join('\n')
  const hunks = m.parseUnifiedDiff(diff)
  assert.equal(hunks.length, 2)
  assert.deepEqual(plain(m.diffStats(hunks)), { added: 1, deleted: 2 })
  const rows = m.diffRows(hunks, lines.length)
  assert.deepEqual(plain(rows.filter(r => r.kind === 'fold')), [{ kind: 'fold', start: 1, count: 1 }, { kind: 'fold', start: 7, count: 13 }, { kind: 'fold', start: 23, count: 8 }].filter(r => r.count > 1 || r.start !== 1))
  assert.equal(rows.filter(r => r.kind === 'deleted').length, 2)
  assert.equal(m.diffRows(hunks, lines.length, { expandAll: true }).filter(r => r.kind === 'fold').length, 0)
  const blocks = m.changeBlocks(hunks)
  assert.deepEqual(plain(blocks), [{ newLine: 4, added: 1, deleted: 1 }, { newLine: 21, added: 0, deleted: 1 }])
  const marks = m.stripes(hunks, lines.length)
  assert.equal(marks.get(4), 'modified')
  assert.equal(marks.get(21), 'deleted')
})

test('diff model handles untracked files and pure deletions', () => {
  const m = moduleAt('client/src/shared/code-viewer/diff-model.ts')
  const added = m.parseUnifiedDiff('diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\n+b\n')
  assert.deepEqual(plain(m.stripes(added, 2)), plain(new Map([[1, 'added'], [2, 'added']])))
  assert.equal(m.diffRows(added, 2).length, 2)
  const removed = m.parseUnifiedDiff('--- a/n\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n')
  const rows = m.diffRows(removed, 0)
  assert.deepEqual(plain(rows.map(r => r.kind)), ['deleted', 'deleted'])
  assert.equal(m.parseUnifiedDiff('Binary files a/x and b/x differ\n').length, 0)
  const dashed = m.parseUnifiedDiff('@@ -1,2 +1,1 @@\n--- x\n+y\n z\n')
  assert.equal(dashed[0].lines.length, 3)
})

test('screen state is one value computed from the server data', () => {
  const { screenState, countUnresolved } = moduleAt('client/src/features/code/utils/screen-state.ts')
  const review = { id: 'r' }
  const live = (over = {}) => ({ review, rounds: [], agent_working: false, head_changed: false, ...over })
  const state = (changes, current, opened = null) => screenState({ changes, current, opened })
  assert.equal(state(0, live({ review: null })), 'clean')
  assert.equal(state(0, null), 'clean')
  assert.equal(state(3, live({ review: null })), 'changes')
  assert.equal(state(3, live()), 'reviewing')
  assert.equal(state(3, live({ agent_working: true, rounds: [{}] })), 'agent-working')
  assert.equal(state(3, live({ rounds: [{}] })), 'agent-replied')
  assert.equal(state(3, live({ head_changed: true })), 'committed')
  assert.equal(state(0, live({ head_changed: true })), 'all-committed')
  assert.equal(state(0, live({ head_changed: true, agent_working: true })), 'agent-working', 'a running agent hides the commit banner')
  assert.equal(state(0, live(), { review }), 'history')
  assert.equal(countUnresolved([{ closed: false }, { closed: false }, { closed: true }, { closed: false }]), 3, 'every open thread is unresolved')
})

test('viewed marks open the review, comparison bases fall back, the committed summary stays', async () => {
  const h = harness()
  const calls = []
  h.codeReviewsApi.markViewedCurrent = async (...args) => { calls.push(['current', ...args]); return { review: null, view: null } }
  h.codeReviewsApi.markViewed = async (...args) => { calls.push(['review', ...args]); return null }
  h.codeReviewsApi.baseChanges = async () => ({ base: 'a', end: 'b', changes: [{ path: 'x.ts', status: 'M' }], stats: {} })
  await h.store.start('p')
  assert.equal(h.store.screen, 'clean')
  await h.store.toggleViewed('x.ts')
  assert.deepEqual(calls.shift(), ['current', 'p', 'x.ts', true, 'project', 'p'])
  await h.store.setBase('agent')
  assert.equal(h.store.effectiveBase, 'head', 'no review, no rounds: the base stays HEAD')

  h.codeReviewsApi.current = async () => ({ review: { id: 'r1', number: 1 }, items: [], rounds: [{ id: 'q1', n: 1 }], other_reviews: [], running_other_reviews: [], agent_working: false, head_changed: true,
    file_views: [{ path: 'x.ts', viewed: true, changed_after_view: false }, { path: 'y.ts', viewed: false, changed_after_view: true }] })
  await h.store.refresh()
  assert.equal(h.store.screen, 'all-committed')
  assert.deepEqual(plain(h.store.viewedState), { 'x.ts': 'viewed', 'y.ts': 'changed' })
  await h.store.toggleViewed('x.ts')
  assert.deepEqual(calls.shift(), ['review', 'p', 'r1', 'x.ts', false])
  await h.store.toggleViewed('y.ts')
  assert.deepEqual(calls.shift(), ['review', 'p', 'r1', 'y.ts', true], 'a stale mark is re-checked, not removed')
  await h.store.setBase('review')
  assert.equal(h.store.effectiveBase, 'review')
  assert.deepEqual(plain(h.store.shownChanges), [{ path: 'x.ts', status: 'M' }])
  assert.deepEqual(plain(h.store.diffEnds), { base: 'a', end: 'b' })
  assert.equal(h.store.commitBannerShown, true, 'all-committed always shows the summary')
  h.store.stop()
})
