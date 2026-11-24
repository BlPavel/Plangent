const { test } = require('node:test')
const assert = require('node:assert/strict')
const { window } = require('linkedom').parseHTML('<html><body></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key]
Object.defineProperty(window.HTMLInputElement.prototype, 'checked', { configurable: true, get() { return this.testChecked ?? false }, set(value) { this.testChecked = !!value } })
const { createApp, h, reactive, ref, effectScope, nextTick } = require('vue')
const { createPinia, setActivePinia } = require('pinia')
const { loader } = require('./client-test-loader.cjs')

function modules(storage = new Map()) {
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  const load = loader({}, { localStorage })
  return {
    useVisibility: load('client/src/core/composables/useRemarkVisibility.ts').useRemarkVisibility,
    useStore: load('client/src/core/stores/remark-visibility.ts').useRemarkVisibilityStore,
    Toggle: load('client/src/shared/ui/AppClosedItemsToggle.vue').default,
    Notice: load('client/src/shared/ui/AppClosedItemNotice.vue').default,
  }
}

test('closed preference is shared across surfaces, persisted, and tolerates unavailable storage', async () => {
  const storage = new Map(), { useStore } = modules(storage)
  setActivePinia(createPinia())
  const first = useStore(), second = useStore()
  assert.equal(first.showClosed, false)
  first.showClosed = true
  assert.equal(second.showClosed, true)
  assert.equal(storage.get('plangent:show-closed-remarks'), '1')
  setActivePinia(createPinia())
  assert.equal(useStore().showClosed, true, 'a fresh app restores the preference')
  useStore().showClosed = false
  assert.equal(storage.get('plangent:show-closed-remarks'), '0')
  const load = loader({}, { localStorage: { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } } })
  setActivePinia(createPinia())
  const unavailable = load('client/src/core/stores/remark-visibility.ts').useRemarkVisibilityStore()
  assert.equal(unavailable.showClosed, false)
  assert.doesNotThrow(() => { unavailable.showClosed = true })
})

test('only closed entries hide; navigation exceptions reset on owner changes and deleted entries', async () => {
  setActivePinia(createPinia())
  const { useVisibility } = modules(), scope = effectScope()
  const owner = ref('file-a')
  const entries = reactive([{ id: 'draft', closed: false }, { id: 'waiting', closed: false }, { id: 'closed', closed: true }])
  const state = scope.run(() => useVisibility(() => owner.value, () => entries.map(item => ({ ...item }))))
  try {
    assert.deepEqual(entries.filter(item => state.visible(item.id, item.closed)).map(item => item.id), ['draft', 'waiting'])
    assert.equal(state.hiddenCount.value, 1)
    state.reveal('closed')
    assert.equal(state.visible('closed', true), true)
    assert.equal(state.preference.showClosed, false)
    assert.equal(state.hiddenCount.value, 0)
    owner.value = 'file-b'
    await nextTick()
    assert.equal(state.visible('closed', true), false)
    state.reveal('closed')
    entries.pop(); await nextTick()
    entries.push({ id: 'closed', closed: true }); await nextTick()
    assert.equal(state.visible('closed', true), false, 'deleted ids do not keep a reveal exception')
    state.preference.showClosed = true
    assert.equal(state.visible('closed', true), true)
    assert.equal(state.hiddenCount.value, 0)
  } finally { scope.stop() }
})

test('closing leaves a notice, reopening restores the card, and a new scope hides old notices', async () => {
  setActivePinia(createPinia())
  const { useVisibility } = modules(), scope = effectScope(), owner = ref('review-a')
  const entries = reactive([{ id: 'one', closed: false }])
  const state = scope.run(() => useVisibility(() => owner.value, () => entries.map(item => ({ ...item }))))
  try {
    entries[0].closed = true; await nextTick()
    assert.equal(state.visible('one', true), true)
    assert.equal(state.notice('one', true), true)
    state.reveal('one')
    assert.equal(state.notice('one', true), false)
    entries[0].closed = false; await nextTick()
    entries[0].closed = true; await nextTick()
    assert.equal(state.notice('one', true), true)
    owner.value = 'review-b'; await nextTick()
    assert.equal(state.visible('one', true), false)
  } finally { scope.stop() }
})

test('checkboxes synchronize and notice reveals one card without changing the shared preference', async () => {
  const { useVisibility, Toggle, Notice } = modules()
  const pinia = createPinia(), entries = reactive([{ id: 'one', closed: false }, { id: 'old', closed: true }])
  const root = document.createElement('div'); document.body.appendChild(root)
  let visibility
  const app = createApp({ setup() {
    visibility = useVisibility(() => 'review', () => entries.map(item => ({ ...item })))
    return () => h('section', [
      ...[1, 2].map(() => h(Toggle, { modelValue: visibility.preference.showClosed, hiddenCount: visibility.hiddenCount.value, 'onUpdate:modelValue': value => { visibility.preference.showClosed = value } })),
      ...entries.filter(item => visibility.visible(item.id, item.closed)).map(item => h(Notice, { notice: visibility.notice(item.id, item.closed), onReveal: () => visibility.reveal(item.id) }, () => h('article', item.id))),
    ])
  } })
  app.use(pinia); app.mount(root)
  const toggle = async checked => {
    const input = root.querySelector('input'); input.checked = checked
    input.dispatchEvent(new window.Event('change', { bubbles: true })); await nextTick()
  }
  try {
    assert.equal(root.querySelectorAll('article').length, 1)
    assert.match(root.textContent, /Скрыто закрытых: 1/)
    await toggle(true)
    assert.equal(root.querySelectorAll('article').length, 2)
    assert.equal(root.querySelectorAll('input')[1].checked, true)
    await toggle(false)
    entries[0].closed = true; await nextTick()
    assert.equal(root.querySelectorAll('article').length, 0)
    assert.match(root.textContent, /Замечание закрыто/)
    root.querySelector('button').click(); await nextTick()
    assert.equal(root.querySelector('article').textContent, 'one')
    assert.equal(visibility.preference.showClosed, false)
    assert.match(root.textContent, /Скрыто закрытых: 1/)
  } finally { app.unmount(); root.remove() }
})

test('code review list keeps answered items visible and closed-only filter overrides the preference', async () => {
  const empty = { render: () => null }
  const code = reactive({ projectId: 'p', review: { id: 'r', number: 1 }, messages: [], items: [
    { id: 'draft', status: 'draft', closed: false },
    { id: 'answered', status: 'answered', closed: false },
    { id: 'closed', status: 'done', closed: true },
  ] })
  const load = loader({
    '../stores/code': { useCodeStore: () => code },
    '../stores/review-agent': { useReviewAgentStore: () => ({ permissions: [] }) },
    '@features/agents': { useAgentsStore: () => ({ agents: [] }), permissionPolicy: () => ({}), ensureAgentCli: async () => ({ installed: true, state: 'done' }), getAgentInstallMode: async () => 'ask' },
    '@features/agent-chat': { ChatView: empty, ReviewAgentBar: empty, UsageMeter: empty, statusLabel: () => '' },
    '@core/stores/app': { useAppStore: () => ({}) },
    './AgentReview.vue': { default: empty }, './RecentReviews.vue': { default: empty },
    './FinishReview.vue': { default: empty }, './ItemComposer.vue': { default: empty },
    './ItemView.vue': { default: { props: ['item'], setup: props => () => h('article', props.item.id) } },
  })
  const Panel = load('client/src/features/code/components/ReviewPanel.vue').default
  const root = document.createElement('div'); document.body.appendChild(root)
  const app = createApp(Panel, { projectId: 'p', origin: { type: 'project', id: 'p' } }).use(createPinia())
  app.mount(root)
  const cards = () => [...root.querySelectorAll('article')].map(item => item.textContent)
  try {
    assert.deepEqual(cards(), ['answered', 'draft'])
    assert.match(root.textContent, /Скрыто закрытых: 1/)
    const closedTab = [...root.querySelectorAll('[role=tab]')].find(tab => tab.textContent.startsWith('Закрытые'))
    assert.ok(closedTab)
    closedTab.click(); await nextTick()
    assert.deepEqual(cards(), ['closed'])
    assert.equal(root.querySelector('input[type=checkbox]').checked, false)
    const allTab = [...root.querySelectorAll('[role=tab]')].find(tab => tab.textContent.startsWith('Открытые'))
    allTab.click(); await nextTick()
    code.items[1].closed = true; await nextTick()
    assert.match(root.textContent, /Замечание закрыто/)
    assert.deepEqual(cards(), ['draft'])
    const input = root.querySelector('input[type=checkbox]'); input.checked = true
    input.dispatchEvent(new window.Event('change', { bubbles: true })); await nextTick()
    assert.deepEqual(cards().sort(), ['answered', 'closed', 'draft'])
  } finally { app.unmount(); root.remove() }
})

test('MR section follows the shared preference without duplicating the remarks checkbox', async () => {
  const external = reactive({ data: { mr: { url: 'https://example.test/mr/1', iid: 1 }, threads: [
    { id: 'open', resolved: false }, { id: 'resolved', resolved: true },
  ] } })
  const load = loader({
    '../stores/external': { useExternalThreadsStore: () => external },
    './ExternalThreadCard.vue': { default: { props: ['thread'], setup: props => () => h('article', props.thread.id) } },
  })
  const Panel = load('client/src/features/code/components/ExternalThreadsPanel.vue').default
  const root = document.createElement('div'); document.body.appendChild(root)
  const app = createApp(Panel).use(createPinia()); app.mount(root)
  try {
    assert.equal(root.querySelectorAll('article').length, 1)
    assert.equal(root.querySelector('input[type=checkbox]'), null)
    const preference = load('client/src/core/stores/remark-visibility.ts').useRemarkVisibilityStore()
    preference.showClosed = true; await nextTick()
    assert.equal(root.querySelectorAll('article').length, 2)
    preference.showClosed = false; await nextTick()
    external.data.threads[0].resolved = true; await nextTick()
    assert.equal(root.querySelectorAll('article').length, 0)
    assert.match(root.textContent, /Замечание закрыто/)
  } finally { app.unmount(); root.remove() }
})

test('branch diff filters card anchors together with cards and restores closed questions and remarks', async () => {
  const empty = { render: () => null }
  const remarkCard = { props: ['remark'], setup: props => () => h('article', props.remark.id) }
  const questionCard = { props: ['question'], setup: props => () => h('article', props.question.id) }
  const threadCard = { props: ['thread'], setup: props => () => h('article', props.thread.id) }
  const place = { path: 'a.ts', side: 'new', line: 1 }
  const screen = reactive({ path: 'a.ts', panel: 'overview', memberId: '', onlyChanged: false,
    detail: { review: { id: 'r', head: 'head', mr_iid: 1 }, files: [{ path: 'a.ts', status: 'M' }], commits: [] },
    info: { mr: { head_sha: 'head', author: { name: 'Author' } }, threads: [{ ...place, id: 'thread', resolved: true, notes: [] }] },
    remarks: [{ ...place, id: 'draft', status: 'draft' }, { ...place, id: 'rejected', status: 'rejected' }, { ...place, id: 'outdated', status: 'rejected', outdated: true }],
    questions: [{ ...place, id: 'question', closed: true }], messages: [], thread: {},
  })
  let anchors = []
  const load = loader({
    '@core/composables/useCodeScreen': { useCodeScreen() {} },
    '@core/api/events': { onServerEvent: () => () => {} },
    '@core/stores/app': { useAppStore: () => ({ currentProject: { name: 'Project' } }) },
    '@features/code': { ExternalThreadCard: threadCard },
    '../stores/review': { useBranchReviewStore: () => ({ of: () => screen }) },
    '../api': { branchReviewApi: {
      detail: async () => screen.detail, mr: async () => screen.info,
      remarks: async () => ({ remarks: screen.remarks }), questions: async () => ({ questions: screen.questions, messages: [] }),
    } },
    '../components/BranchDiff.vue': { default: { props: ['items'], setup(props, { slots }) {
      return () => { anchors = props.items; return h('div', slots.items({ line: 1, side: 'new' })) }
    } } },
    '../components/RemarkCard.vue': { default: remarkCard },
    '../components/BranchQuestionCard.vue': { default: questionCard },
    '../components/MrList.vue': { default: empty }, '../components/OverviewPanel.vue': { default: empty },
    '../components/QueueBar.vue': { default: empty }, '../components/ThreadDiscussion.vue': { default: empty },
    '../components/RemarksPanel.vue': { default: empty },
  }, { localStorage: { getItem: () => null, setItem() {} } })
  const Panel = load('client/src/features/branch-review/views/BranchReviewTab.vue').default
  const root = document.createElement('div'); document.body.appendChild(root)
  const app = createApp(Panel, { projectId: 'p' }).use(createPinia()); app.mount(root)
  try {
    await nextTick(); await nextTick()
    assert.equal(root.querySelectorAll('article').length, 1)
    assert.equal(anchors.length, 1)
    assert.equal(root.querySelector('main input[type=checkbox]'), null)
    const preference = load('client/src/core/stores/remark-visibility.ts').useRemarkVisibilityStore()
    preference.showClosed = true; await nextTick()
    assert.deepEqual([...root.querySelectorAll('article')].map(card => card.textContent).sort(), ['draft', 'question', 'rejected', 'thread'])
    assert.equal(anchors.length, 4, 'outdated remarks never acquire a current anchor')
  } finally { app.unmount(); root.remove() }
})
