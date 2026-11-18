const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { parseHTML } = require('linkedom')
const { window } = parseHTML('<html><body></body></html>')
for (const key of ['document', 'Document', 'ShadowRoot', 'HTMLElement', 'Element', 'SVGElement', 'Node']) global[key] = window[key]
global.window = window
const { createPinia, setActivePinia, getActivePinia } = require('pinia')
beforeEach(() => setActivePinia(createPinia()))
const { createApp, reactive, nextTick, h } = require('vue')

function component(file, mocks) {
  return require('./client-test-loader.cjs').loader({ '@core/composables/useDraft': require('./drafts-test-support.cjs'), '@core/stores/drafts': require('./drafts-test-support.cjs'), ...mocks })(file).default
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 380)); await nextTick() }
function mount(comp, props = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(comp, props); app.use(getActivePinia()); app.mount(root)
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
    button(screen.root, 'Коммит · 1').click(); await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].action, 'commit')
    assert.equal(calls[0].data.title, 'TASK edited')
    assert.equal(calls[0].data.body, 'Why it changed')
    assert.equal(calls[0].data.includeDescription, true)
    assert.equal(calls[0].data.includeCoauthors, true)
    assert.equal(calls[0].data.coauthors[0].email, 'peer@test.invalid')
    assert.equal(calls[0].data.overrideForbidden, false)
    assert.match(screen.root.querySelector('[role="status"]').textContent, /Коммит создан/)
    assert.equal(screen.root.querySelector('pre'), null, 'a successful commit does not show the hook log')
    assert.equal(screen.root.querySelector('.cb-cancel'), null)
    assert.match(screen.root.textContent, /prev/, 'the last commit stays visible')
    git.blocked = 'Идёт выполнение'; input(message, 'TASK next'); await nextTick()
    assert.ok(button(screen.root, 'Коммит · 1').disabled)
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
    button(screen.root, 'Коммит').click(); await settle()
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
    '@features/agent-chat': require('./client-test-loader.cjs').loader()('client/src/features/agent-chat/utils/mention-drag.ts'),
    '../stores/context': { useCodeContext: () => ({ projectId: 'p', workspaceId: 'work' }) },
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
    const data = new Map()
    const drag = new window.Event('dragstart', { bubbles: true })
    drag.dataTransfer = { setData: (type, value) => data.set(type, value) }
    screen.root.querySelector('.cl-row').dispatchEvent(drag)
    assert.equal(data.get('text/plain'), '@src/a.ts')
    assert.equal(JSON.parse(data.get('application/x-plangent-mention')).workspaceId, 'work')
    assert.equal(screen.root.textContent.includes('Просмотрено'), false)
  } finally { screen.close() }
})

/** The real branch field is a typed input with a dropdown; here a plain select with the same options stands in. */
const BranchSelectStub = { props: ['modelValue', 'options'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('select', { onChange: e => emit('update:modelValue', e.target.value) }, (props.options ?? []).map(o => h('option', { value: o.value, selected: o.value === props.modelValue }, o.label))) } }
const BranchNameStub = { props: ['modelValue'], emits: ['update:modelValue'], setup(props, { emit }) { return () => h('input', { 'aria-label': 'Имя новой ветки', value: props.modelValue, onInput: e => emit('update:modelValue', e.target.value) }) } }
test('branch picker refreshes origin, switches remote branches, preserves the chosen base and explains failures', async () => {
  const calls = []; let closed = 0, fail = true
  const refs = [{ name: 'main', ref: 'refs/heads/main', remote: false }, { name: 'origin/release', ref: 'refs/remotes/origin/release', remote: true }]
  const git = reactive({ projectId: 'p', repository: { branch: 'main' }, branches: refs.slice(0, 1), blocked: '', settings: { branch_prefixes: [], base_branch: 'main' },
    refreshBranches: async () => refs,
    run: async (action, data) => { calls.push([action, data]); if (fail) throw Object.assign(new Error('Git operation failed'), { output: 'Your local changes would be overwritten by checkout' }) },
  })
  const comp = component('client/src/features/code/components/BranchPicker.vue', {
    '../stores/git': { useGitStore: () => git }, '@shared/ui/BranchNameInput.vue': { default: BranchNameStub }, '@shared/ui/BranchSelect.vue': { default: BranchSelectStub },
  })
  const screen = mount(comp, { onClose: () => closed++ })
  try {
    await settle()
    const remote = [...screen.root.querySelectorAll('button')].find(b => b.textContent.trim() === 'origin/release')
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

test('task branches use the shared picker, bind the current branch, save created branches and respect write locks', async () => {
  const calls = [], saves = []
  const task = reactive({ id: 't', key: 'TASK-1', branch_name: 'old', base_commit: 'a'.repeat(40) })
  const refs = [{ name: 'main', ref: 'refs/heads/main', remote: false }]
  const git = reactive({ projectId: 'p', repository: { branch: 'main', head: 'b'.repeat(40) }, branches: refs, settings: { branch_prefixes: [], base_branch: 'main' }, writeBlocked: '',
    start: async () => {}, stop: () => {}, refreshBranches: async () => refs,
    run: async (action, data) => { calls.push([action, data]); git.repository.branch = data.branch ?? data.name; if (action === 'branch') git.branches.push({ name: data.name, remote: false }) },
  })
  const picker = component('client/src/features/code/components/BranchPicker.vue', {
    '../stores/git': { useGitStore: () => git }, '@shared/ui/BranchNameInput.vue': { default: BranchNameStub }, '@shared/ui/BranchSelect.vue': { default: BranchSelectStub },
  })
  const comp = component('client/src/features/tasks/components/TaskGit.vue', {
    '@core/stores/app': { useAppStore: () => ({ confirm: async () => true }) },
    '@features/code': { BranchPicker: picker, useGitStore: () => git },
    '@shared/utils/errorText': { errorText: String },
    '@core/api': { api: {
      patch: async (url, data) => { saves.push([url, data]); return { ...task, ...data } },
      post: async url => { saves.push([url]); return { ...task, base_commit: git.repository.head } },
    } },
  })
  const screen = mount(comp, { projectId: 'p', task, onUpdated: updated => Object.assign(task, updated) })
  try {
    assert.match(screen.root.textContent, /ветки нет в репозитории/)
    button(screen.root, 'Сменить').click(); await settle()
    button(screen.root, 'main').click(); await settle()
    assert.equal(task.branch_name, 'main')
    assert.equal(calls.length, 0, 'binding the current branch does not switch again')
    assert.equal(saves[0][0], '/projects/p/tasks/t')
    button(screen.root, 'Сменить').click(); await settle()
    input(screen.root.querySelector('[aria-label="Имя новой ветки"]'), 'feature/task'); await nextTick()
    screen.root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle()
    assert.equal(calls.at(-1)[0], 'branch')
    assert.equal(task.branch_name, 'feature/task')
    assert.equal(screen.root.querySelector('.tg-warning'), null)
    screen.root.querySelector('button[aria-expanded]').click(); await nextTick();
    button(screen.root, 'Считать от текущего коммита').click(); await settle()
    assert.equal(task.base_commit, 'b'.repeat(40))
    assert.equal(saves.at(-1)[0], '/projects/p/tasks/t/base-commit')
    git.writeBlocked = 'Идёт rebase'; await nextTick()
    assert.ok(button(screen.root, 'Сменить').disabled)
    assert.ok(button(screen.root, 'Считать от текущего коммита').disabled)
  } finally { screen.close() }
})

function finishPanel(store, git) {
  git.refreshBranches = async () => git.branches
  return component('client/src/features/finish/components/FinishPanel.vue', {
    '@shared/ui/AppButton.vue': { default: component('client/src/shared/ui/AppButton.vue', {}) },
    '@core/api': { api: { get: async () => null } },
    '@core/stores/app': { useAppStore: () => ({ confirm: async () => true }) },
    '@features/code': { CommitDiff: { render: () => null }, CoauthorsField: { render: () => null }, GitAgentNote: { render: () => null }, useGitStore: () => git },
    '@shared/ui/BranchNameInput.vue': { default: BranchNameStub }, '@shared/ui/BranchSelect.vue': { default: BranchSelectStub },
    '../finish-scenarios': { FINISH_SCENARIOS: { commits: { label: 'Только коммиты', hint: '' }, push: { label: 'Коммиты и push', hint: '' }, full: { label: 'Полный цикл', hint: '' } } },
    '../stores/finish': { useFinishStore: () => store },
    '../api': { finishApi: { context: async () => ({ changes: [], diffs: {} }) }, finishEndpoints: { getProjectsByProjectIdFinishTaskByTaskId: async () => null } },
    '../types': { scenarios: { commits: 'Только коммиты' }, stages: { confirmation: 'Подтверждение', done: 'Готово' }, statuses: { waiting: 'Ждёт подтверждения', complete: 'Выполнено' } },
  })
}
const gitSettings = { finish_scenario: 'full', base_branch: 'main', include_description: true, branch_prefixes: ['feature'], mr_reviewers: ['7'], mr_squash: true, mr_remove_branch: false, agent: { agentId: 'a', model: '', effort: '' } }

test('finish form takes its defaults from the git settings and starts with the chosen commit mode and a new branch', async () => {
  const started = []
  const store = reactive({ run: null, busy: false, error: '', load: async () => {}, start: async options => { started.push(JSON.parse(JSON.stringify(options))) } })
  const git = reactive({ settings: gitSettings, repository: { branch: 'main', head: 'base', upstream: null }, coauthors: [], branches: [{ name: 'main', ref: 'refs/heads/main' }, { name: 'origin/main', ref: 'refs/remotes/origin/main' }] })
  const screen = mount(finishPanel(store, git), { projectId: 'p', task: { id: 't', key: 'ABC-1' }, branch: 'main' })
  try {
    await settle()
    assert.equal(screen.root.querySelector('input[value="full"]').getAttribute('checked'), 'true', 'scenario from the settings')
    assert.match(screen.root.textContent, /squash/)
    assert.match(screen.root.textContent, /опубликована в origin/)
    assert.equal(screen.root.querySelector('[aria-label="Имя новой ветки"]').value, 'feature/ABC-1', 'on the target branch a new branch is required')
    toggle(screen.root.querySelector('input[value="single"]'), true); await nextTick()
    assert.equal(button(screen.root, 'Начать завершение').disabled, false)
    screen.root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle()
    assert.equal(started.length, 1)
    assert.equal(started[0].autoContinue, true)
    assert.equal(started[0].commitMode, 'single')
    assert.equal(started[0].targetBranch, 'main')
    assert.equal(started[0].branchName, 'feature/ABC-1')
    assert.equal(started[0].includeDescription, true)
    toggle([...screen.root.querySelectorAll('label')].find(l => l.textContent.includes('Завершить автоматически')).querySelector('input'), false); await nextTick()
    screen.root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle()
    assert.equal(started[1].autoContinue, false)
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

test('MR threads render with their location', async () => {
 const calls = []
 const store = { data: null, loading: false, error: '', pull: async () => { calls.push('pull'); store.data = { mr: { iid: 3, url: 'u', title: 't', state: 'opened' }, threads: [{ id: 'd1', resolved: false, path: 'a.ts', line: 4, side: 'new', notes: [{ id: 1, author: 'Иван', body: 'почему так?' }] }] } },
  reply: async (id, body) => { calls.push(['reply', id, body]) } }
 const card = component('client/src/features/code/components/ExternalThreadCard.vue', {
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

test('commit draft survives tab remounts and stays separate for each workspace', async () => {
  const git = reactive({ projectId: 'p', repository: {}, blocked: '', writeBlocked: '', coauthors: [], settings: {} })
  const code = reactive({ changes: [], refresh: async () => {} })
  const comp = commitBox(git, code, { checkMessage: async () => ({ violations: [] }) })
  let view = mount(comp)
  const message = 'Keep this title\n\nAnd description'
  input(view.root.querySelector('textarea'), message)
  await nextTick()
  view.close()
  view = mount(comp)
  assert.equal(view.root.querySelector('textarea').value, message)
  git.workspaceId = 'task-workspace'
  await nextTick()
  assert.equal(view.root.querySelector('textarea').value, '')
  input(view.root.querySelector('textarea'), 'Task draft')
  await nextTick()
  git.workspaceId = undefined
  await nextTick()
  assert.equal(view.root.querySelector('textarea').value, message)
  git.projectId = 'other'
  await nextTick()
  assert.equal(view.root.querySelector('textarea').value, '')
  view.close()
})


test('code contexts use the owner stores and fall back to the main instance', () => {
  const main = reactive({ name: 'main' }), side = reactive({ name: 'side' })
  const mainGit = reactive({ name: 'main-git' }), sideGit = reactive({ name: 'side-git' })
  const context = require('./client-test-loader.cjs').loader({
    './code': { useCodeStore: () => main }, './git': { useGitStore: () => mainGit },
  })('client/src/features/code/stores/context.ts')
  const Child = { setup() { const code = context.useCodeContext(), git = context.useGitContext(); return () => h('span', code.name + ':' + git.name) } }
  const Owner = { setup() { context.provideCodeStores(side, sideGit); return () => h(Child) } }
  const screen = mount({ render: () => h('div', [h(Child), h(Owner)]) })
  try { assert.equal(screen.root.textContent, 'main:main-gitside:side-git') } finally { screen.close() }
})

test('code screen count survives overlapping mounts and returns to zero after navigation', () => {
  const state = reactive({ codeScreenCount: 0 })
  const { useCodeScreen } = require('./client-test-loader.cjs').loader({
    '@core/stores/app': { useAppStore: () => state },
  })('client/src/core/composables/useCodeScreen.ts')
  const Screen = { setup() { useCodeScreen(); return () => h('div') } }
  const first = mount(Screen), second = mount(Screen)
  assert.equal(state.codeScreenCount, 2)
  first.close(); assert.equal(state.codeScreenCount, 1)
  second.close(); assert.equal(state.codeScreenCount, 0)
  const returned = mount(Screen)
  assert.equal(state.codeScreenCount, 1)
  returned.close(); assert.equal(state.codeScreenCount, 0)
})

test('named git stores keep their branches and lifecycle separate', async () => {
  const handlers = new Set()
  const { useGitStore } = require('./client-test-loader.cjs').loader({
    '@core/api/events': { onServerEvent: fn => { handlers.add(fn); return () => handlers.delete(fn) } },
    '../api': { gitApi: {
      repository: async (_p, w) => ({ branch: w }), branches: async (_p, w) => [{ name: w, remote: false }],
      settings: async () => ({}), coauthors: async () => [],
    } },
  })('client/src/features/code/stores/git.ts')
  const main = useGitStore(), side = useGitStore('side')
  await main.start('p', 'first'); await side.start('p', 'second')
  assert.equal(main.repository.branch, 'first')
  assert.equal(side.repository.branch, 'second')
  main.stop()
  assert.equal(handlers.size, 1)
  await side.refresh()
  assert.equal(side.branches[0].name, 'second')
  assert.equal(side.workspaceId, 'second')
  side.stop(); assert.equal(handlers.size, 0)
})


test('overflowing file tabs support wheel, paging, active reveal and a full-path file menu', async () => {
  let observer
  class ResizeObserverMock {
    constructor(callback) { this.callback = callback; observer = this }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  const comp = require('./client-test-loader.cjs').loader({
    '../composables/useMentionDrag': { useMentionDrag: () => () => {} },
    '@shared/code-viewer': { fileIconName: () => '', iconSvg: () => '' },
    '@shared/composables/usePopover': { usePopover: () => ({ style: require('vue').ref({}) }) },
  }, { ResizeObserver: ResizeObserverMock })('client/src/features/code/components/CodeFileTabs.vue').default
  const state = reactive({
    files: Array.from({ length: 12 }, (_, i) => ({ path: `folder-${i}/index.ts` })),
    active: 'folder-0/index.ts',
  })
  let closed = false
  const screen = mount({ setup: () => () => h(comp, {
    ...state, statuses: {}, onSelect: path => { state.active = path }, 'onClose-all': () => { closed = true },
  }) })
  try {
    const viewport = screen.root.querySelector('[data-file-tabs-viewport]')
    let width = 300
    Object.defineProperties(viewport, {
      clientWidth: { get: () => width }, scrollWidth: { get: () => state.files.length * 150 },
    })
    viewport.scrollLeft = 0
    viewport.getBoundingClientRect = () => ({ left: 0, right: width, width })
    for (const [index, tab] of [...viewport.querySelectorAll('[role="tab"]')].entries()) {
      tab.getBoundingClientRect = () => ({ left: index * 150 - viewport.scrollLeft, right: (index + 1) * 150 - viewport.scrollLeft, width: 150 })
    }
    viewport.scrollBy = options => {
      viewport.scrollLeft += options.left
      viewport.dispatchEvent(new window.Event('scroll'))
    }
    observer.callback(); await nextTick(); await nextTick()
    const nav = label => screen.root.querySelector(`[aria-label="Прокрутить вкладки ${label}"]`)
    assert.equal(nav('влево').disabled, true)
    assert.equal(nav('вправо').disabled, false)
    nav('вправо').click(); await nextTick()
    assert.equal(viewport.scrollLeft, 240)
    assert.equal(nav('влево').disabled, false)
    const wheel = (deltaY, ctrlKey = false, deltaX = 0) => {
      const event = new window.Event('wheel', { cancelable: true })
      Object.assign(event, { deltaY, deltaX, deltaMode: 0, ctrlKey })
      viewport.dispatchEvent(event)
      return event
    }
    assert.equal(wheel(100).defaultPrevented, true)
    assert.equal(viewport.scrollLeft, 340)
    assert.equal(wheel(100, true).defaultPrevented, false)
    assert.equal(wheel(0, false, 100).defaultPrevented, false)
    assert.equal(viewport.scrollLeft, 340)

    state.active = 'folder-11/index.ts'
    await settle()
    assert.equal(viewport.scrollLeft, 1500, 'selection reveals the last tab without scrolling the page')
    assert.equal(nav('вправо').disabled, true)
    width = 180
    observer.callback(); await nextTick()
    assert.equal(viewport.scrollLeft, 1620, 'resizing keeps the selected tab visible')

    screen.root.querySelector('[aria-label="Открытые файлы (12)"]').click(); await nextTick()
    const menu = document.querySelector('[role="menu"]')
    const choices = [...menu.querySelectorAll('[role="menuitem"]')]
    assert.match(choices[11].textContent, /✓ index.ts/)
    assert.match(choices[0].textContent, /folder-0\/index.ts/)
    assert.match(choices[11].textContent, /folder-11\/index.ts/)
    choices[0].click(); await settle()
    assert.equal(state.active, 'folder-0/index.ts')
    assert.equal(viewport.scrollLeft, 0)
    screen.root.querySelector('[aria-label="Открытые файлы (12)"]').click(); await nextTick()
    button(document.querySelector('[role="menu"]'), 'Закрыть все файлы').click()
    assert.equal(closed, true)
    width = 2000
    observer.callback(); await nextTick()
    assert.equal(nav('вправо'), null, 'paging controls disappear when files fit')
  } finally { screen.close() }
  assert.equal(observer.disconnected, true)
})

test('tree paths, file tabs and search hits produce references with their owning workspace', async () => {
  const load = require('./client-test-loader.cjs').loader
  const mentions = load()('client/src/features/agent-chat/utils/mention-drag.ts')
  const code = reactive({ projectId: 'p', workspaceId: 'work', files: ['src/a.ts'], matches: [{ path: 'src/a.ts', line: 12, text: 'match' }], cancelSearch() {}, clearSearch() {}, search() {} })
  const mocks = {
    '@features/agent-chat': mentions,
    '../stores/context': { useCodeContext: () => code },
    '@shared/code-viewer': { fileIconName: () => '', iconSvg: () => '', ...load()('client/src/shared/code-viewer/find.ts') },
  }
  const modules = load(mocks, { ResizeObserver: class { observe() {} disconnect() {} } })
  const drag = element => {
    assert.equal(element.getAttribute('draggable'), 'true')
    const values = new Map()
    const dataTransfer = { setData: (type, value) => values.set(type, value), getData: type => values.get(type) || '' }
    const event = new window.Event('dragstart', { bubbles: true }); event.dataTransfer = dataTransfer
    element.dispatchEvent(event)
    return mentions.readMentionDrag(dataTransfer)
  }
  const Tree = modules('client/src/shared/code-viewer/FileTree.vue').default
  const tree = mount(Tree, { trees: { '': [{ name: 'src', path: 'src', directory: true, changes: 0 }] }, draggable: true,
    onDragPath: (event, path, dir) => mentions.writeMentionDrag(event.dataTransfer, { projectId: 'p', workspaceId: 'work', path, dir }) })
  try { const payload = drag(tree.root.querySelector('[role=treeitem]')); assert.equal(payload.path, 'src'); assert.equal(payload.dir, true) }
  finally { tree.close() }
  const tabs = mount(modules('client/src/features/code/components/CodeFileTabs.vue').default, { files: [{ path: 'src/a.ts' }], active: 'src/a.ts', statuses: {} })
  try { const payload = drag(tabs.root.querySelector('[role=tab]')); assert.equal(payload.path, 'src/a.ts'); assert.equal(payload.workspaceId, 'work') }
  finally { tabs.close() }
  const search = mount(modules('client/src/features/code/components/SearchPanel.vue').default)
  try {
    const payload = drag(search.root.querySelector('.sp-line').closest('button'))
    assert.equal(payload.startLine, 12); assert.equal(payload.path, 'src/a.ts'); assert.equal(payload.workspaceId, 'work')
    const file = drag(search.root.querySelector('.sp-file-name').closest('button'))
    assert.equal(file.startLine, undefined); assert.equal(file.path, 'src/a.ts')
  } finally { search.close() }
})

test('file tree renders only the rows in view and shares icons through one sprite', async () => {
  const load = require('./client-test-loader.cjs').loader
  const modules = load({}, { ResizeObserver: class { observe() {} disconnect() {} } })
  const entries = Array.from({ length: 2000 }, (_, i) => ({ name: 'f' + i + '.ts', path: 'f' + i + '.ts', directory: false, changes: 0 }))
  const tree = mount(modules('client/src/shared/code-viewer/FileTree.vue').default, { trees: { '': entries }, marks: { 'f1.ts': 2 } })
  try {
    const rows = tree.root.querySelectorAll('[role=treeitem]')
    assert.ok(rows.length > 0 && rows.length < 100, `rendered ${rows.length} of 2000 rows`)
    assert.ok(tree.root.querySelector('.tree-icon use'), 'rows reference the sprite')
    assert.equal(document.querySelectorAll('[id="cv-icon-file-type-typescript-official"]').length, 1)
  } finally { tree.close() }
})
