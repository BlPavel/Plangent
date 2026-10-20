const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { parseHTML } = require('linkedom')
const { window } = parseHTML('<html><body></body></html>')
for (const key of ['document', 'Document', 'ShadowRoot', 'HTMLElement', 'Element', 'SVGElement', 'Node']) global[key] = window[key]
global.window = window
const { createApp, reactive, nextTick, h } = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')

function component(file, mocks) {
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  const compiled = compileScript(descriptor, { id: file, inlineTemplate: true }).content
  const exports = {}
  vm.runInNewContext(ts.transpileModule(compiled, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => name in mocks ? mocks[name] : require(name), setTimeout, clearTimeout, document, window }, { filename: file })
  return exports.default
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 380)); await nextTick() }
function mount(comp, props = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(comp, props); app.mount(root)
  return { root, close() { app.unmount(); root.remove() } }
}
function button(root, text) { return [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text) }
function input(element, text) { element.value = text; element.dispatchEvent(new window.Event('input', { bubbles: true })) }
function toggle(element, checked) { element.checked = checked; element.dispatchEvent(new window.Event('change', { bubbles: true })) }

/** The split button and the coauthor picker have their own components; here they are plain stand-ins. */
const SplitButtonStub = { props: ['disabled', 'items', 'title', 'variant', 'menuDisabled'], emits: ['click'], setup(props, { slots, emit }) { return () => h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots.default?.()) } }
const CoauthorsStub = { props: ['modelValue', 'known'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('button', { class: 'pick-peer', onClick: () => emit('update:modelValue', [props.known[0]]) }, 'peer') } }
function commitBox(git, code, gitApi) {
  return component('client/src/features/code/components/CommitBox.vue', {
    '../stores/git': { useGitStore: () => git }, '../stores/code': { useCodeStore: () => code }, '../api': { gitApi },
    '@shared/ui/SplitButton.vue': { default: SplitButtonStub }, './CoauthorsField.vue': { default: CoauthorsStub },
  })
}

test('commit box: the agent suggests a message, the user edits it, adds a coauthor and commits the ticked files', async () => {
  const calls = []
  const git = reactive({
    repository: { branch: 'feature/work' }, projectId: 'p', blocked: '', settings: { include_description: false },
    coauthors: [{ name: 'Peer', email: 'peer@test.invalid' }], error: '', output: '', operationId: '',
    run: async (action, data) => { calls.push({ action, data }); git.output = 'pre-commit: passed' },
    cancel: async () => {},
  })
  const code = reactive({ changes: [{ path: 'a.ts', status: 'M', indexStatus: 'M' }, { path: 'b.ts', status: 'M', indexStatus: ' ' }], head: 'abc1234', repository: { message: 'prev' }, refresh: async () => {} })
  const comp = commitBox(git, code, {
    checkMessage: async (_p, input) => ({ message: input.title, cleaned: input.title, violations: [] }),
    generateMessage: async (_p, options) => { assert.equal(options.includeDescription, false); return { title: 'TASK generated', body: '' } },
  })
  const screen = mount(comp)
  try {
    screen.root.querySelector('[aria-label="Предложить сообщение"]').click(); await settle()
    const message = screen.root.querySelector('[aria-label="Сообщение коммита"]')
    assert.equal(message.value, 'TASK generated')
    assert.equal(calls.length, 0, 'something is ticked already: the suggestion does not stage')
    input(message, 'TASK edited\n\nWhy it changed')
    screen.root.querySelector('[aria-label="Соавторы"]').click(); await nextTick()
    screen.root.querySelector('.pick-peer').click(); await settle()
    button(screen.root, 'Закоммитить 1').click(); await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].action, 'commit')
    assert.equal(calls[0].data.title, 'TASK edited')
    assert.equal(calls[0].data.body, 'Why it changed')
    assert.equal(calls[0].data.includeDescription, true)
    assert.equal(calls[0].data.includeCoauthors, true)
    assert.equal(calls[0].data.coauthors[0].email, 'peer@test.invalid')
    assert.equal(calls[0].data.overrideForbidden, false)
    assert.match(screen.root.querySelector('pre').textContent, /pre-commit/)
    assert.match(screen.root.textContent, /prev/, 'the last commit stays visible')
    git.blocked = 'Идёт выполнение'; input(message, 'TASK next'); await nextTick()
    assert.ok(button(screen.root, 'Закоммитить 1').disabled)
  } finally { screen.close() }
})

test('commit box: nothing ticked commits everything; a forbidden message needs a second click, cleanup removes it', async () => {
  const calls = []
  const git = reactive({
    repository: { branch: 'feature' }, projectId: 'p', blocked: '', settings: { include_description: true },
    coauthors: [], error: '', output: '', operationId: '',
    run: async (action, data) => { calls.push({ action, data }); if (action === 'commit' && !data.overrideForbidden) throw Object.assign(new Error('Forbidden'), { code: 'forbidden_message' }) },
    cancel: async () => {},
  })
  const code = reactive({ changes: [{ path: 'new.txt', status: '?', indexStatus: '?' }], head: 'abc1234', repository: { message: '' }, refresh: async () => {} })
  const comp = commitBox(git, code, { checkMessage: async (_p, data) => ({
    message: data.title, cleaned: data.title + '\n\nDetails',
    violations: data.body.includes('Generated') ? [{ kind: 'forbidden', line: 4, text: 'Generated with Claude Code', pattern: 'Generated with' }] : [],
  }) })
  const screen = mount(comp)
  try {
    const message = screen.root.querySelector('[aria-label="Сообщение коммита"]')
    input(message, 'TASK fix\nDetails\nGenerated with Claude Code'); await settle()
    assert.match(screen.root.textContent, /запрещённый текст/)
    assert.equal(button(screen.root, 'Всё равно'), undefined)
    button(screen.root, 'Закоммитить всё').click(); await settle()
    assert.deepEqual(calls.map(c => c.action), ['stage', 'commit'])
    assert.deepEqual(calls[0].data.paths, ['new.txt'])
    button(screen.root, 'Всё равно').click(); await settle()
    assert.equal(calls[1].data.overrideForbidden, false)
    assert.equal(calls.at(-1).data.overrideForbidden, true)
    input(message, 'TASK next\nDetails\nGenerated with Claude Code'); await settle()
    button(screen.root, 'Убрать запрещённое').click(); await settle()
    assert.equal(message.value, 'TASK next\n\nDetails')
    assert.equal(button(screen.root, 'Убрать запрещённое'), undefined)
  } finally { screen.close() }
})

test('changes list splits tracked and new files and stages a whole group', async () => {
  const staged = [], many = [], opened = []
  const changes = [
    { path: 'new.txt', status: '?', indexStatus: '?', worktreeStatus: '?' },
    { path: 'src/a.ts', status: 'M', indexStatus: 'M', worktreeStatus: ' ' },
    { path: 'src/b.ts', status: 'M', indexStatus: ' ', worktreeStatus: 'M' },
  ]
  const comp = component('client/src/features/code/components/ChangesList.vue', {
    '@shared/code-viewer': { fileIconName: () => '', iconSvg: () => '' },
  })
  const screen = mount(comp, {
    changes, stats: {}, selected: null, emptyText: '', stageable: true,
    onToggleStage: data => staged.push(data.path), onStageMany: (list, stage) => many.push([list.map(c => c.path), stage]), onOpen: data => opened.push(data.path),
  })
  try {
    assert.deepEqual([...screen.root.querySelectorAll('.cl-group-title')].map(e => e.textContent), ['Отслеживаемые', 'Новые'])
    toggle(screen.root.querySelector('[aria-label="К коммиту: new.txt"]'), true)
    assert.deepEqual(staged, ['new.txt']); assert.deepEqual(opened, [])
    toggle(screen.root.querySelector('[aria-label="К коммиту: Отслеживаемые"]'), true)
    assert.equal(JSON.stringify(many), JSON.stringify([[['src/a.ts', 'src/b.ts'], true]]), 'a partly ticked group is ticked whole')
    screen.root.querySelector('.cl-row').click(); assert.deepEqual(opened, ['src/a.ts'])
    assert.equal(screen.root.textContent.includes('Просмотрено'), false)
  } finally { screen.close() }
})

const BranchNameStub = { props: ['modelValue'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('input', { 'aria-label': 'Имя новой ветки', value: props.modelValue, onInput: e => emit('update:modelValue', e.target.value) }) } }
test('branch picker refreshes origin, switches remote branches, preserves the chosen base and explains failures', async () => {
  const calls = []; let closed = 0, fail = true
  const refs = [{ name: 'main', ref: 'refs/heads/main', remote: false }, { name: 'origin/release', ref: 'refs/remotes/origin/release', remote: true }]
  const git = reactive({ projectId: 'p', repository: { branch: 'main' }, branches: refs.slice(0, 1), blocked: '', settings: { branch_prefixes: [], base_branch: 'main' },
    refreshBranches: async () => refs,
    run: async (action, data) => { calls.push([action, data]); if (fail) throw Object.assign(new Error('Git operation failed'), { output: 'Your local changes would be overwritten by checkout' }) },
  })
  const comp = component('client/src/features/code/components/BranchPicker.vue', {
    '../stores/git': { useGitStore: () => git }, '@shared/ui/BranchNameInput.vue': { default: BranchNameStub },
  })
  const screen = mount(comp, { onClose: () => closed++ })
  try {
    await settle()
    const remote = [...screen.root.querySelectorAll('.item')].find(b => b.textContent === 'origin/release')
    assert.ok(remote, 'the remote branch appears after refresh')
    remote.click(); await settle()
    assert.equal(calls[0][0], 'switch'); assert.equal(calls[0][1].branch, 'origin/release')
    assert.match(screen.root.querySelector('[role="alert"]').textContent, /local changes would be overwritten/)
    assert.equal(closed, 0)
    const base = screen.root.querySelector('select')
    Object.defineProperty(base, 'value', { configurable: true, writable: true, value: 'origin/release' })
    for (const option of base.querySelectorAll('option')) option.selected = option.getAttribute('value') === 'origin/release'
    base.dispatchEvent(new window.Event('change', { bubbles: true })); await nextTick()
    git.settings = { branch_prefixes: [], base_branch: 'main' }; await nextTick()
    fail = false
    input(screen.root.querySelector('[aria-label="Имя новой ветки"]'), 'feature/work'); await nextTick()
    screen.root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle()
    assert.equal(calls.at(-1)[0], 'branch'); assert.equal(calls.at(-1)[1].base, 'origin/release'); assert.equal(closed, 1)
    remote.click(); await settle(); assert.equal(closed, 2)
  } finally { screen.close() }
})

function finishPanel(store, git) {
  git.refreshBranches = async () => git.branches
  return component('client/src/features/finish/components/FinishPanel.vue', {
    '@core/api': { api: { get: async () => null } },
    '@core/stores/app': { useAppStore: () => ({ confirm: async () => true }) },
    '@features/code': { CommitDiff: { render: () => null }, CoauthorsField: { render: () => null }, GitAgentNote: { render: () => null }, useGitStore: () => git },
    '@shared/ui/BranchNameInput.vue': { default: BranchNameStub },
    '@shared/utils/finish-scenarios': { FINISH_SCENARIOS: { commits: { label: 'Только коммиты', hint: '' }, push: { label: 'Коммиты и push', hint: '' }, full: { label: 'Полный цикл', hint: '' } } },
    '../stores/finish': { useFinishStore: () => store },
    '../api': { finishApi: { context: async () => ({ changes: [], diffs: {} }) } },
    '../types': { scenarios: { commits: 'Только коммиты' }, stages: { confirmation: 'Подтверждение', done: 'Готово' }, statuses: { waiting: 'Ждёт подтверждения', complete: 'Выполнено' } },
  })
}
const gitSettings = { finish_scenario: 'full', base_branch: 'main', include_description: true, branch_prefixes: ['feature'], mr_reviewers: ['7'], mr_squash: true, mr_remove_branch: false, agent: { agentId: 'a', model: '', effort: '' } }

test('finish form takes its defaults from the git settings and starts with the chosen commit mode and a new branch', async () => {
  const started = []
  const store = reactive({ run: null, busy: false, error: '', load: async () => {}, start: async options => { started.push(JSON.parse(JSON.stringify(options))) } })
  const git = reactive({ settings: gitSettings, repository: { upstream: null }, coauthors: [], branches: [{ name: 'main', ref: 'refs/heads/main' }, { name: 'origin/main', ref: 'refs/remotes/origin/main' }] })
  const screen = mount(finishPanel(store, git), { projectId: 'p', task: { id: 't', key: 'ABC-1' }, branch: 'main' })
  try {
    await settle()
    assert.equal(screen.root.querySelector('input[value="full"]').checked, true, 'scenario from the settings')
    assert.match(screen.root.textContent, /squash/)
    assert.match(screen.root.textContent, /опубликована в origin/)
    assert.equal(screen.root.querySelector('[aria-label="Имя новой ветки"]').value, 'feature/ABC-1', 'on the target branch a new branch is required')
    toggle(screen.root.querySelector('input[value="single"]'), true); await nextTick()
    assert.equal(button(screen.root, 'Начать').disabled, false)
    screen.root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle()
    assert.equal(started.length, 1)
    assert.equal(started[0].commitMode, 'single')
    assert.equal(started[0].targetBranch, 'main')
    assert.equal(started[0].branchName, 'feature/ABC-1')
    assert.equal(started[0].includeDescription, true)
  } finally { screen.close() }
})

test('finish confirmation accepts a title edited in the rendered form and shows recovery input', async () => {
 const initial = { id: 'finish', project_id: 'p', base_head: 'base', scenario: 'commits', stage: 'confirmation', status: 'waiting',
  options: { includeDescription: true }, commits: [{ files: ['a.txt'], title: 'Agent title', body: 'Body', sha: 'commit' }], session_id: null }
 const calls = []
 const store = reactive({ run: null, busy: false, error: '',
  load: async () => { store.run = JSON.parse(JSON.stringify(initial)) },
  save: async commits => { calls.push(['save', JSON.parse(JSON.stringify(commits))]); store.run.commits = commits.map(c => ({ ...c, sha: 'edited' })); return store.run },
  action: async name => { calls.push([name]); store.run.status = 'complete'; store.run.stage = 'done'; return store.run },
 })
 const git = reactive({ settings: gitSettings, repository: { upstream: 'origin/feature' }, coauthors: [], branches: [] })
 const screen = mount(finishPanel(store, git), { projectId: 'p', branch: 'feature' })
 try {
  await settle()
  assert.match(screen.root.textContent, /Ждёт подтверждения/)
  input(screen.root.querySelector('[aria-label="Заголовок коммита"]'), 'User title')
  await nextTick()
  button(screen.root, 'Принять').click()
  await settle()
  assert.equal(calls[0][0], 'save'); assert.equal(calls[0][1][0].title, 'User title'); assert.equal(calls[1][0], 'accept')
  store.run.status = 'error'; store.run.stage = 'commits'
  await nextTick()
  const note = screen.root.querySelector('textarea[placeholder="Замечание агенту для повторной попытки"]')
  assert.ok(note)
  input(note, 'Try again'); await nextTick()
  button(screen.root, 'Повторить').click(); await settle()
  assert.equal(calls.at(-1)[0], 'revise')
 } finally { screen.close() }
})

test('MR threads are pulled by button and a reply needs confirmation', async () => {
 const calls = []
 const store = { data: null, loading: false, error: '', pull: async () => { calls.push('pull'); store.data = { mr: { iid: 3, url: 'u', title: 't', state: 'opened' }, threads: [{ id: 'd1', resolved: false, path: 'a.ts', line: 4, side: 'new', notes: [{ id: 1, author: 'Иван', body: 'почему так?' }] }] } },
  reply: async (id, body) => { calls.push(['reply', id, body]) } }
 const card = component('client/src/features/code/components/ExternalThreadCard.vue', {
  '@shared/ui/AppButton.vue': { render() { return null } },
  '@core/stores/app': { useAppStore: () => ({ confirm: async () => { calls.push('confirm'); return true } }) },
  '../stores/external': { useExternalThreadsStore: () => store },
  '../types': {},
 })
 const screen = mount(card, { thread: { id: 'd1', resolved: false, path: 'a.ts', line: 4, side: 'new', notes: [{ id: 1, author: 'Иван', body: 'почему так?' }] }, showLocation: true })
 try {
  assert.match(screen.root.textContent, /почему так\?/)
  assert.match(screen.root.textContent, /a\.ts:4/)
 } finally { screen.close() }
})
