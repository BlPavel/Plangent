const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createPinia, setActivePinia } = require('pinia')

function moduleAt(file, mocks = {}, globals = {}, sourceOverride) {
  return require('./client-test-loader.cjs').loader({ '@core/stores/drafts': require('./drafts-test-support.cjs'), '@core/composables/useDraft': require('./drafts-test-support.cjs'), ...mocks }, globals, false)(file, sourceOverride)
}
const plain = value => JSON.parse(JSON.stringify(value))

test('side code availability follows mounted code screens and the current place', () => {
  const { reactive, ref } = require('vue')
  const appStore = reactive({ currentProject: { kind: 'project' }, codeScreenCount: 0 })
  const terminalPlace = ref({ projectId: 'p' }), isSettingsRoute = ref(false)
  const source = fs.readFileSync('client/src/app/App.vue', 'utf8')
  const declaration = source.match(/const codeAvailable = computed\([\s\S]*?\)\r?\n/)[0]
  const { available } = moduleAt('client/src/app/App.vue', {}, { appStore, terminalPlace, isSettingsRoute },
    "import { computed } from 'vue';\n" + declaration + '\nexports.available = codeAvailable;')
  const mounted = [], unmounted = []
  const { useCodeScreen } = moduleAt('client/src/core/composables/useCodeScreen.ts', {
    vue: { onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn) },
    '@core/stores/app': { useAppStore: () => appStore },
  })
  assert.equal(available.value, true)
  useCodeScreen(); useCodeScreen()
  mounted.forEach(fn => fn())
  assert.equal(available.value, false)
  unmounted[0]()
  assert.equal(available.value, false, 'another code screen is still mounted')
  unmounted[1]()
  assert.equal(available.value, true)
  for (const kind of ['group', 'source']) {
    appStore.currentProject.kind = kind
    assert.equal(available.value, false)
  }
  appStore.currentProject = null
  assert.equal(available.value, false)
  appStore.currentProject = { kind: 'project' }
  terminalPlace.value = null
  assert.equal(available.value, false)
  terminalPlace.value = { projectId: 'p' }
  isSettingsRoute.value = true
  assert.equal(available.value, false)
  isSettingsRoute.value = false
  assert.equal(available.value, true)
})

test('side panel preserves tabs and comparison independently for each project and worktree', () => {
  setActivePinia(createPinia())
  const store = moduleAt('client/src/features/code/stores/side-panel.ts').useSidePanelStore()
  const main = store.place('p', null), first = store.place('p', 'w1'), second = store.place('p', 'w2')
  const other = store.place('other', null)
  store.open(first, 'a.ts', 'file'); store.open(first, 'b.ts', 'diff')
  first.list = 'search'; first.base = 'round'; first.baseRound = 'r1'
  store.open(second, 'a.ts', 'diff'); store.open(main, 'main.ts', 'file')
  assert.deepEqual(plain(store.place('p', 'w1')), plain(first))
  assert.deepEqual(plain(first.files), [{ path: 'a.ts', mode: 'file' }, { path: 'b.ts', mode: 'diff' }])
  assert.equal(first.baseRound, 'r1')
  assert.equal(second.base, 'head'); assert.equal(second.list, 'changes')
  store.open(first, 'a.ts', 'diff')
  assert.equal(first.files.length, 2)
  store.close(first, 'a.ts'); assert.equal(first.active, 'b.ts')
  store.closeAll(second); assert.equal(second.active, null)
  assert.equal(main.active, 'main.ts')
  store.forgetWorkspace('w1')
  assert.equal(store.place('p', 'w1').files.length, 0)
  store.forgetProject('p')
  assert.deepEqual(plain(Object.values(store.places)), [plain(other)])
})

test('send to chat picks the last typed visible field in the same workspace and cleans registrations', async () => {
  setActivePinia(createPinia())
  const store = moduleAt('client/src/features/agent-chat/stores/composer-targets.ts').useComposerTargetsStore()
  const mention = { projectId: 'p', workspaceId: 'w', path: 'a.ts', dir: false }
  const inserted = []
  const register = (name, workspaceId = 'w', visible = true, projectId = 'p') => store.register({
    projectId: () => projectId, workspaceId: () => workspaceId, visible: () => visible,
    insert: async value => { inserted.push([name, value]); return true },
  })
  const first = register('first'), last = register('last')
  store.touch(last); store.touch(register('hidden', 'w', false))
  store.touch(register('main', null)); store.touch(register('foreign', 'w', true, 'other'))
  assert.equal(await store.insertMention(mention), true)
  assert.deepEqual(inserted, [['last', mention]])
  store.unregister(last)
  await store.insertMention(mention)
  assert.equal(inserted[1][0], 'first')
  store.unregister(first)
  assert.equal(await store.insertMention(mention), false)
  let revealed
  const removeReveal = store.addReveal({ projectId: () => 'p', workspaceId: () => 'w', visible: () => true,
    show: async () => { revealed = register('revealed') } })
  assert.equal(await store.insertMention(mention), true)
  assert.equal(inserted[2][0], 'revealed')
  store.unregister(revealed); removeReveal()
  assert.equal(await store.insertMention(mention), false)
})
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
  const { useCodeStore } = moduleAt('client/src/features/code/stores/code.ts', {
    '@core/api/events': events, '../events': events, '../api': { codeApi, codeReviewsApi },
    '../utils/screen-state': moduleAt('client/src/features/code/utils/screen-state.ts'),
  })
  const store = useCodeStore()
  return { store, useCodeStore, codeApi, codeReviewsApi, handlers, stops, calls: () => calls,
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
  const codeEvents = moduleAt('client/src/features/code/events.ts', { '@core/api/events': events }); const stopHandler = events.onServerEvent(() => {})
  const stopA = codeEvents.subscribeCodeProject('p')
  const stopB = codeEvents.subscribeCodeProject('p')
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
  let data = [{ project_id: 'p', review_id: 'r', origin: 'task', origin_id: 'task', count: 1, items: [{ origin: 'task', origin_id: 'task' }] }]
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

test('attention follows each remark origin even when Code and tasks share a review', async () => {
  setActivePinia(createPinia())
  const code = { id: 'code', origin: 'project', origin_id: 'p' }
  const task = { id: 'task', origin: 'task', origin_id: 't' }
  const otherTask = { id: 'other', origin: 'task', origin_id: 'other' }
  const data = [
    { project_id: 'p', review_id: 'r', origin: 'project', origin_id: 'p', count: 3, items: [code, task, otherTask] },
    { project_id: 'p', review_id: 'r2', origin: 'task', origin_id: 't', count: 1, items: [task] },
    { project_id: 'other', review_id: 'r3', origin: 'project', origin_id: 'other', count: 1, items: [code] },
  ]
  const store = moduleAt('client/src/features/code/stores/attention.ts', {
    '@core/api/events': { onServerEvent: () => () => {} },
    '../api': { codeReviewsApi: { attention: async () => data } },
  }).useCodeAttentionStore()
  await store.load('p')
  assert.equal(store.countFor(store.forCode('p')), 1)
  assert.deepEqual(plain(store.forCode('p')[0].items), [code])
  assert.equal(store.countFor(store.forTask('t')), 2)
  assert.equal(store.countFor(store.forTask('other')), 1)
  assert.equal(store.countFor(store.forTask('missing')), 0)
  store.stop()
})

test('project tabs show work attention in Tasks and only Code remarks in Code', () => {
  const { ref } = require('vue')
  const source = fs.readFileSync('client/src/features/projects/views/HomeView.vue', 'utf8')
  const declaration = source.match(/const tabs = computed<TabItem\[\]>\([\s\S]*?\n    \]\)/)[0]
  const currentProject = ref({ id: 'p' }), isGroup = ref(false)
  const { tabs } = moduleAt('client/src/features/projects/views/HomeView.vue', {}, {
    currentProject, isGroup, members: ref([]),
    workAttention: { countFor: id => id === 'p' ? 2 : 0 },
    codeAttentionCount: ref(1),
  }, "import { computed } from 'vue';\n" + declaration + '\nexports.tabs = tabs;')
  assert.equal(tabs.value.find(tab => tab.id === 'tasks').count, 2)
  assert.equal(tabs.value.find(tab => tab.id === 'code').count, 1)
  currentProject.value = { id: 'other' }
  assert.equal(tabs.value.find(tab => tab.id === 'tasks').count, 0)
  isGroup.value = true
  assert.equal(tabs.value.some(tab => tab.id === 'tasks' || tab.id === 'code'), false)
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
  const drafts = require('./drafts-test-support.cjs').useDraftsStore()
  drafts.get('code-review:r:composer:a', () => 'unsent')
  drafts.get('code-review:other:composer:a', () => 'keep')
  await h.store.removeReview('r')
  assert.equal(drafts.drafts['code-review:r:composer:a'], undefined)
  assert.equal(drafts.drafts['code-review:other:composer:a'], 'keep')
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

test('comparison bases fall back without a review, the committed summary stays', async () => {
  const h = harness()
  h.codeReviewsApi.baseChanges = async () => ({ base: 'a', end: 'b', changes: [{ path: 'x.ts', status: 'M' }], stats: {} })
  await h.store.start('p')
  assert.equal(h.store.screen, 'clean')
  await h.store.setBase('agent')
  assert.equal(h.store.effectiveBase, 'head', 'no review, no rounds: the base stays HEAD')

  h.codeReviewsApi.current = async () => ({ review: { id: 'r1', number: 1 }, items: [], rounds: [{ id: 'q1', n: 1 }], other_reviews: [], running_other_reviews: [], agent_working: false, head_changed: true,
    file_views: [{ path: 'x.ts', viewed: true, changed_after_view: false }, { path: 'y.ts', viewed: false, changed_after_view: true }] })
  await h.store.refresh()
  assert.equal(h.store.screen, 'all-committed')
  await h.store.setBase('review')
  assert.equal(h.store.effectiveBase, 'review')
  assert.deepEqual(plain(h.store.shownChanges), [{ path: 'x.ts', status: 'M' }])
  assert.deepEqual(plain(h.store.diffEnds), { base: 'a', end: 'b' })
  assert.equal(h.store.commitBannerShown, true, 'all-committed always shows the summary')
  h.store.stop()
})

test('review item stops showing work after a reply even while its agent remains busy', () => {
  const { reactive } = require('vue')
  const props = reactive({ item: { id: 'item', status: 'sent', closed: false } })
  const code = reactive({ messages: [] })
  const agent = reactive({ busy: true, focusItem: 'item' })
  const file = 'client/src/features/code/components/ItemView.vue'
  const script = fs.readFileSync(file, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const view = moduleAt(file, {
    '@core/stores/app': { useAppStore: () => ({}) },
    '../stores/context': { useCodeContext: () => code },
    '../stores/review-agent': { useReviewAgentStore: () => agent },
    '../utils/thread': moduleAt('client/src/features/code/utils/thread.ts'),
    './ItemCard.vue': {}, './ItemComposer.vue': {},
  }, { defineProps: () => props, defineEmits: () => () => {} }, script + '\nexports.working = working; exports.state = state;')
  assert.equal(view.working.value, true)
  for (const status of ['answered', 'done', 'needs_decision']) {
    props.item.status = status
    assert.equal(view.state.value, 'waiting')
    assert.equal(view.working.value, false, status)
  }
  props.item.closed = true
  assert.equal(view.working.value, false)
  props.item.closed = false
  props.item.status = 'sent'
  assert.equal(view.working.value, true, 'a new round resumes the indicator')
  code.messages.push({ item_id: 'item', author: 'developer', sent: false })
  assert.equal(view.state.value, 'queued')
  assert.equal(view.working.value, false)
  code.messages = []
  agent.busy = false
  assert.equal(view.working.value, false)
  agent.busy = true
  agent.focusItem = 'other'
  assert.equal(view.working.value, false)
})

test('review status label reflects active work only while the item is with the agent', () => {
  const { stateLabel } = moduleAt('client/src/features/code/utils/thread.ts')
  assert.equal(stateLabel({ status: 'sent' }, 'agent', true), 'Агент работает над этим пунктом…')
  assert.equal(stateLabel({ status: 'sent' }, 'agent', false), 'У агента')
  assert.equal(stateLabel({ status: 'answered' }, 'waiting', true), 'Агент ответил')
  assert.equal(stateLabel({ status: 'done' }, 'waiting', true), 'Проверьте правку')
  assert.equal(stateLabel({ status: 'needs_decision' }, 'waiting', true), 'Агент не согласен')
})

test('review suggestions are plain discussion text, including historical structured options', () => {
  const { discussionText } = moduleAt('client/src/features/code/utils/thread.ts')
  assert.equal(discussionText({ text: '1. A\n2. B (рекомендую)', options: [] }), '1. A\n2. B (рекомендую)')
  assert.equal(discussionText({ text: 'Possible approaches:', options: [{ label: 'A' }, { label: 'B', recommended: true }] }),
    'Possible approaches:\n\n1. A\n2. B (рекомендую)')
})

test('review session completion clears stale busy state and lets a queued discussion be sent', async () => {
  const h = harness()
  const { reactive } = require('vue')
  let current = { review: { id: 'review' }, items: [{ id: 'item', status: 'answered', closed: false }],
    messages: [{ item_id: 'item', author: 'developer', text: 'Change it', sent: false }],
    rounds: [{ session_id: 'session' }], other_reviews: [], file_views: [], agent_working: true }
  h.codeReviewsApi.current = async () => current
  const chats = reactive({ sessions: [{ id: 'session', role: 'code-fixer', status: 'thinking' }], snapshots: { session: { events: [], permissions: [] } }, connect: async () => {} })
  const agent = moduleAt('client/src/features/code/stores/review-agent.ts', {
    '@core/api': { api: {} }, '@features/agent-chat': { useChatStore: () => chats }, './code': { useCodeStore: () => h.store }, '../utils/thread': moduleAt('client/src/features/code/utils/thread.ts'),
  }).useReviewAgentStore()
  const { threadState } = moduleAt('client/src/features/code/utils/thread.ts')
  await h.store.start('p')
  try {
    assert.equal(agent.busy, true)
    assert.equal(h.store.screen, 'agent-working')
    assert.equal(threadState(h.store.items[0], h.store.messages), 'queued')
    // The chat receives ready first, but the old review response still says agent_working=true.
    chats.sessions[0].status = 'ready'
    current = { ...current, agent_working: false }
    assert.equal(agent.busy, true, 'stale review state would keep Send disabled')
    const reads = h.calls()
    h.emit({ type: 'agent_session', session: { id: 'other', project_id: 'other', role: 'code-fixer', status: 'ready' } })
    h.emit({ type: 'agent_session', session: { id: 'chat', project_id: 'p', role: 'chat', status: 'ready' } })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(h.calls(), reads, 'unrelated sessions do not refresh the code screen')
    h.emit({ type: 'agent_session', session: { id: 'session', project_id: 'p', role: 'code-fixer', status: 'ready' } })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(h.store.agentWorking, false)
    assert.equal(agent.busy, false)
    assert.equal(h.store.screen, 'agent-replied')
    assert.equal(threadState(h.store.items[0], h.store.messages), 'queued', 'the reply stays pending until explicitly sent')
    let submitted
    h.codeReviewsApi.sendRound = async (...args) => {
      submitted = args
      current = { ...current, agent_working: true, items: [{ ...current.items[0], status: 'sent' }],
        messages: [{ ...current.messages[0], sent: true }] }
    }
    await agent.send(['item'])
    assert.deepEqual(submitted, ['p', 'review', 'session', '', ['item'], undefined])
    assert.equal(threadState(h.store.items[0], h.store.messages), 'agent')
    assert.equal(h.store.messages[0].sent, true)
    // Failures and subsequent turns also refresh the server's busy flag.
    for (const [status, working] of [['error', false], ['thinking', true], ['complete', false]]) {
      chats.sessions[0].status = status
      current = { ...current, agent_working: working }
      h.emit({ type: 'agent_session', session: { id: 'session', project_id: 'p', role: 'code-fixer', status } })
      await new Promise(resolve => setTimeout(resolve, 150))
      assert.equal(h.store.agentWorking, working, status)
      assert.equal(agent.busy, working, status)
    }
  } finally { h.store.stop() }
})


test('review completion notifications use the existing channels, link to Code and ignore repeats or cancellations', () => {
  let handler, focused = true
  const toasts = [], notifications = [], routes = []
  const chats = { sessions: [{ id: 'review', role: 'code-fixer', project_id: 'p', title: 'Ревью #5' }, { id: 'chat', role: 'chat', project_id: 'p' }] }
  const notificationsModule = moduleAt('client/src/features/code/notifications.ts', {
    '@core/api/events': { onServerEvent: callback => { handler = callback; return () => {} } },
    '@core/platform': { platform: { notify: (...args) => { if (!focused) notifications.push(args) } } },
    '@core/stores/app': { useAppStore: () => ({ toast: (...args) => toasts.push(args) }) },
    '@features/agent-chat': { useChatStore: () => chats }, './api': {},
    './navigation': moduleAt('client/src/features/code/navigation.ts'),
  }, { document: { hasFocus: () => focused } })
  notificationsModule.startCodeNotifications({ push: route => routes.push(route) })
  const end = (session_id, seq, stopReason = 'end_turn') => handler({ type: 'agent_event', event: { type: 'turn_end', session_id, seq, payload: { stopReason } } })
  end('review', 1)
  assert.equal(toasts.length, 1)
  assert.equal(notifications.length, 0)
  assert.match(toasts[0][0], /Ревью #5/)
  toasts[0][2].run()
  assert.equal(routes[0], '/?project=p&tab=code')
  end('review', 1)
  end('chat', 2)
  end('review', 2, 'cancelled')
  assert.equal(toasts.length, 1)
  focused = false
  end('review', 3)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0][2], '/?project=p&tab=code')
  assert.equal(toasts.length, 1)
  handler({ type: 'code_review_needs_decision', projectId: 'p' })
  assert.equal(notifications.length, 2, 'existing disagreement notifications still work')
})

test('shared mention search cannot show stale results after another query, dismissal or switching projects', async () => {
  const { effectScope, ref, nextTick } = require('vue')
  const project = ref('p')
  const pending = []
  const mod = moduleAt('client/src/features/agent-chat/composables/useMentionFiles.ts', {
    '@core/api': { api: { get: url => new Promise(resolve => pending.push({ url, resolve })) } },
  })
  const scope = effectScope()
  const search = scope.run(() => mod.useMentionFiles(() => project.value))
  try {
    search.search('old')
    await new Promise(resolve => setTimeout(resolve, 80))
    search.search('new')
    await new Promise(resolve => setTimeout(resolve, 80))
    pending[1].resolve([{ path: 'new.ts', dir: false, uri: 'file:///new.ts' }])
    await new Promise(resolve => setTimeout(resolve, 0))
    pending[0].resolve([{ path: 'old.ts', dir: false, uri: 'file:///old.ts' }])
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(search.suggestions.value[0].value, 'new.ts')
    search.search('cancelled')
    await new Promise(resolve => setTimeout(resolve, 80))
    search.clear()
    pending[2].resolve([{ path: 'cancelled.ts', dir: false }])
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(search.files.value.length, 0)
    search.search('project')
    await new Promise(resolve => setTimeout(resolve, 80))
    project.value = 'other'
    await nextTick()
    pending[3].resolve([{ path: 'previous-project.ts', dir: false }])
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(search.files.value.length, 0)
    assert.equal(search.loading.value, false)
  } finally { scope.stop() }
})

test('project sidebar adds Code decisions and permission requests to its existing queue count', () => {
  const source = fs.readFileSync('client/src/app/App.vue', 'utf8').match(/const projectAttention = \(projectId: string\) => \[[\s\S]*?\n\]/)[0]
  const result = moduleAt('client/src/app/App.vue', {}, {
    blockedQueues: { forProject: () => [{ taskKey: 'TASK-1', reason: 'Existing question' }] },
    codeAttention: { forCode: () => [{ items: [{ file: 'code.ts', text: 'Explain this' }, { file: null, text: 'Choose an approach' }] }] },
    chatStore: { sessions: [{ role: 'code-fixer', project_id: 'p', status: 'waiting', reason: 'Permission required' },
      { role: 'code-fixer', project_id: 'other', status: 'waiting' }, { role: 'chat', project_id: 'p', status: 'waiting' }] },
  }, source + '\nexports.projectAttention = projectAttention;').projectAttention('p')
  assert.equal(result.length, 4)
  assert.equal(result[0].taskKey, 'TASK-1')
  assert.equal(result[1].reason, 'Permission required')
  assert.equal(result[2].reason, 'code.ts: Explain this')
  assert.equal(result[3].taskKey, 'Код')
})

test('remote review comparison preserves branch identity and ignores stale comparison responses', async () => {
 const h = harness(), { store, codeReviewsApi } = h
 await store.start('p')
 let resolveOld
 codeReviewsApi.remoteComparison = async (p, ref) => ref === 'origin/old'
  ? new Promise(resolve => { resolveOld = resolve })
  : { base: 'merge-base', end: 'head', changes: [{ path: 'feature.ts', status: 'M' }], stats: {} }
 const old = store.setBase('remote', 'origin/old')
 await store.setBase('remote', 'origin/main')
 resolveOld({ base: 'stale', end: 'head', changes: [{ path: 'stale.ts' }], stats: {} })
 await old
 assert.equal(store.effectiveBase, 'remote')
 assert.equal(store.remoteRef, 'origin/main')
 assert.equal(store.shownChanges[0].path, 'feature.ts')
 assert.equal(store.diffEnds.base, 'merge-base')
 assert.equal(store.review, null, 'comparing never creates a review')
 await store.setBase('head')
 assert.equal(store.diffEnds, null)
 store.$dispose()
})

test('finish confirmation saves manual edits before accept; moving, merging and splitting preserves files', async () => {
 const { parse, compileScript } = require('@vue/compiler-sfc')
 const { effectScope, reactive } = require('vue')
 const file = 'client/src/features/finish/components/FinishPanel.vue'
 const source = compileScript(parse(fs.readFileSync(file, 'utf8'), { filename: file }).descriptor, { id: 'finish-test' }).content
 const initial = { id: 'run', project_id: 'p', base_head: 'base', status: 'waiting', stage: 'confirmation', scenario: 'commits',
  options: { includeDescription: true }, commits: [{ title: 'First', body: 'Body', files: ['a', 'b'], sha: 'one' }, { title: 'Second', files: ['c'], sha: 'two' }] }
 const calls = []
 const store = reactive({ run: null, busy: false, error: '', load: async () => { store.run = plain(initial) },
  save: async commits => { calls.push(['save', plain(commits)]); store.run.commits = commits.map(c => ({ ...c, sha: 'new' })); return store.run },
  action: async name => { calls.push([name]); store.run.status = 'complete'; return store.run },
 })
 const component = moduleAt(file, {
  '@core/api': { api: { get: async () => ({ values: { finish_scenario: 'commits', branch_template: 'feature/{key}-{slug}' } }) } },
  '@core/stores/app': { useAppStore: () => ({ confirm: async () => true }) },
  '@shared/ui/AppButton.vue': { default: {} }, '@shared/ui/BranchNameInput.vue': { default: {} }, '@shared/ui/BranchSelect.vue': { default: {} },
  '../finish-scenarios': { FINISH_SCENARIOS: { commits: {}, push: {}, full: {} } },
  '@features/code': { CommitDiff: {}, CoauthorsField: {}, GitAgentNote: {}, useGitStore: () => reactive({ settings: { finish_scenario: 'commits', base_branch: '', include_description: true, branch_prefixes: [], mr_reviewers: [] }, repository: { upstream: 'origin/feature' }, branches: [], coauthors: [] }) },
  '../stores/finish': { useFinishStore: () => store },
  '../api': { finishApi: { context: async () => ({ changes: [], diffs: {} }) } },
  '../types': moduleAt('client/src/features/finish/types.ts', { './finish-scenarios': { finishScenarioLabels: {} } }),
 }, {}, source).default
 const scope = effectScope()
 try {
  const panel = scope.run(() => component.setup({ projectId: 'p', branch: 'feature' }, { expose() {}, emit() {} }))
  await new Promise(resolve => setTimeout(resolve, 0))
  panel.selected.value = { index: 0, path: 'a' }
  assert.equal(panel.selectedBase.value, 'base')
  panel.selected.value = { index: 1, path: 'c' }
  assert.equal(panel.selectedBase.value, 'one')
  panel.move(0, 1, 'b')
  panel.merge(1)
  panel.split(0)
  assert.deepEqual(plain(panel.draft.value.flatMap(c => c.files)).sort(), ['a', 'b', 'c'])
  panel.draft.value[0].title = 'Edited by user'
  await panel.accept()
  assert.equal(calls[0][0], 'save')
  assert.equal(calls[0][1][0].title, 'Edited by user')
  assert.equal(calls[1][0], 'accept')
  assert.equal(store.run.status, 'complete')
 } finally { scope.stop() }
})

test('group Git settings: overrides and resets stay in one project', () => {
 const { parse, compileScript } = require('@vue/compiler-sfc')
 const { reactive } = require('vue')
 const file = 'client/src/features/projects/components/GitSettingsFields.vue'
 const source = compileScript(parse(fs.readFileSync(file, 'utf8'), { filename: file }).descriptor, { id: 'git-settings-test' }).content
 const component = moduleAt(file, { '@shared/ui/MemberPicker.vue': { default: {} }, '@shared/ui/BranchSelect.vue': { default: {} }, '@shared/ui/PlainSelect.vue': { default: {} }, '@features/finish': { finishScenarioLabels: {} } }, {}, source).default
 const group = reactive({ base_branch: 'main', mr_squash: true, branch_prefixes: ['feature'] })
 const first = reactive({ modelValue: {}, inherited: group, section: 'mr', sources: { mr_squash: 'group' } })
 const second = reactive({ modelValue: {}, inherited: group, section: 'mr', sources: { mr_squash: 'group' } })
 const setup = props => component.setup(props, { expose() {}, emit: (_, value) => { props.modelValue = value } })
 const a = setup(first), b = setup(second)
 assert.equal(a.value('mr_squash'), true, 'inherited from the group')
 a.set('mr_squash', false)
 assert.equal(first.modelValue.mr_squash, false); assert.equal(group.mr_squash, true)
 assert.equal(a.changed('mr_squash'), true); assert.equal(b.value('mr_squash'), true, 'the other project keeps the group value')
 a.reset('mr_squash')
 assert.equal(Object.hasOwn(first.modelValue, 'mr_squash'), false)
 assert.equal(a.value('mr_squash'), true)
})


test('named code stores keep files, comparison, pending reads and subscriptions independent', async () => {
  const h = harness(), main = h.store, side = h.useCodeStore('side')
  assert.equal(h.useCodeStore(), main)
  assert.equal(h.useCodeStore('side'), side)
  assert.notEqual(main, side)
  await main.start('p', 'main-work')
  await side.start('p', 'side-work')
  await main.selectFile('main.ts')
  await side.selectFile('side.ts')
  main.base = 'remote'; main.remoteRef = 'origin/main'
  assert.equal(side.base, 'head')
  assert.equal(main.selectedPath, 'main.ts')
  assert.equal(side.selectedPath, 'side.ts')
  let release
  h.codeApi.file = async (_p, file) => new Promise(resolve => { release = () => resolve({ path: file, kind: 'text' }) })
  const pending = side.selectFile('pending.ts')
  main.stop()
  assert.equal(h.handlers.size, 1)
  assert.equal(side.projectId, 'p')
  assert.equal(side.workspaceId, 'side-work')
  release(); await pending
  assert.equal(side.file.path, 'pending.ts')
  await main.start('another')
  assert.equal(side.selectedPath, 'pending.ts')
  side.stop()
  assert.equal(main.projectId, 'another')
  assert.equal(h.handlers.size, 1)
  main.stop()
  assert.equal(h.handlers.size, 0)
})

test('mention search follows workspace changes and rejects a late result from the previous folder', async () => {
  const { effectScope, ref, nextTick } = require('vue')
  const workspace = ref('first'), pending = []
  const mod = moduleAt('client/src/features/agent-chat/composables/useMentionFiles.ts', {
    '@features/projects': { projectsEndpoints: { getProjectsByIdMentions: input => new Promise(resolve => pending.push({ input, resolve })) } },
  })
  const scope = effectScope()
  const search = scope.run(() => mod.useMentionFiles(() => 'p', () => workspace.value))
  try {
    search.search('')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(pending[0].input.query.workspace, 'first')
    workspace.value = 'second'; await nextTick()
    search.search('')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(pending[1].input.query.workspace, 'second')
    pending[1].resolve([{ path: 'second.ts', dir: false, uri: 'file:///second/second.ts' }])
    await nextTick(); await nextTick()
    pending[0].resolve([{ path: 'first.ts', dir: false, uri: 'file:///first/first.ts' }])
    await nextTick(); await nextTick()
    assert.equal(search.files.value[0].uri, 'file:///second/second.ts')
    workspace.value = null; await nextTick()
    assert.equal(search.files.value.length, 0)
    search.search('')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(pending[2].input.query.workspace, undefined)
    pending[2].resolve([])
  } finally { scope.stop() }
})

test('review agent launch leaves the hidden sandbox mode to the server permission policy', () => {
  const { ref } = require('vue')
  const file = 'client/src/features/agent-chat/components/ReviewAgentBar.vue'
  const script = fs.readFileSync(file, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  for (const readOnly of [false, true]) {
    const changes = []
    moduleAt(file, {
      '@features/agents': { useAgentsStore: () => ({ agents: [{ id: 'codex', name: 'Codex' }] }) },
      '@features/projects': { useReviewAgentChoice: () => ({ choice: ref({ agentId: 'codex', policy: 'allow-edits' }), loaded: ref(true) }) },
      '@shared/ui/AppButton.vue': {}, '@shared/ui/AppSelect.vue': {}, './UsageMeter.vue': {},
      '../composables/useAgentLaunchOptions': { useAgentLaunchOptions: () => ({
        resolvedSelects: ref([]), state: ref(''),
        launch: () => ({ mode: 'read-only', model: 'model', config: { effort: 'low' } }), pick() {}, retry() {},
      }) },
    }, { defineProps: () => ({ projectId: 'project', readOnly }), defineEmits: () => (_event, pick) => changes.push(pick) }, script)
    assert.equal(changes.length, 1)
    assert.equal(changes[0].mode, '')
    assert.equal(changes[0].policy, readOnly ? 'read-only' : 'allow-edits')
    assert.equal(changes[0].model, 'model')
    assert.deepEqual(plain(changes[0].config), { effort: 'low' })
  }
})
test('streamed search matches arrive in batches and all of them are kept', async () => {
  const h = harness()
  await h.store.start('p')
  h.codeApi.search = async function* () {
    for (let line = 1; line <= 5; line++) yield { type: 'match', path: 'a.ts', line, text: 'x' }
    yield { type: 'done', matches: 5, files: 1, truncated: false }
  }
  await h.store.search({ query: 'x' })
  assert.equal(h.store.matches.map(m => m.line).join(','), '1,2,3,4,5')
  assert.equal(h.store.searchSummary.matches, 5)
  h.store.stop()
})
