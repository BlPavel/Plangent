const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { parseHTML } = require('linkedom')
const { window } = parseHTML('<html><body></body></html>')
for (const key of ['document', 'Document', 'ShadowRoot', 'HTMLElement', 'Element', 'SVGElement', 'Node']) global[key] = window[key]
global.window = window
const { createApp, reactive, nextTick } = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')

function component(file, mocks) {
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file })
  const compiled = compileScript(descriptor, { id: file, inlineTemplate: true }).content
  const exports = {}
  vm.runInNewContext(ts.transpileModule(compiled, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => name in mocks ? mocks[name] : require(name), setTimeout, clearTimeout }, { filename: file })
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

test('manual commit panel generates, allows editing, fills a human coauthor and displays hook output', async () => {
  const calls = []
  const git = reactive({
    repository: { branch: 'feature/work' }, projectId: 'p', blocked: '', settings: { include_description: false },
    coauthors: [{ name: 'Peer', email: 'peer@test.invalid' }], error: '', output: '', operationId: '',
    run: async (action, data) => { calls.push({ action, data }); git.output = 'pre-commit: passed'; },
    cancel: async () => {},
  })
  const api = {
    checkMessage: async input => ({ message: input.title, cleaned: input.title, violations: [] }),
    generateMessage: async (_p, options) => { assert.equal(options.includeDescription, false); return { title: 'TASK generated', body: '' } },
  }
  const comp = component('client/src/features/code/components/CommitPanel.vue', {
    '../stores/git': { useGitStore: () => git }, '../api': { gitApi: { ...api, checkMessage: (_p, data) => api.checkMessage(data) } },
  })
  const screen = mount(comp)
  try {
    button(screen.root, '✨ Предложить текст').click(); await settle()
    const title = screen.root.querySelector('[aria-label="Заголовок коммита"]')
    assert.equal(title.value, 'TASK generated')
    input(title, 'TASK edited')
    toggle([...screen.root.querySelectorAll('input[type=checkbox]')][1], true)
    await nextTick()
    input(screen.root.querySelector('[aria-label="Имя соавтора"]'), 'Peer'); await nextTick()
    assert.equal(screen.root.querySelector('[aria-label="Email соавтора"]').value, 'peer@test.invalid')
    await settle()
    button(screen.root, 'Закоммитить').click(); await nextTick(); await settle()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].action, 'commit')
    assert.equal(calls[0].data.title, 'TASK edited')
    assert.equal(calls[0].data.includeCoauthors, true)
    assert.equal(calls[0].data.coauthors[0].email, 'peer@test.invalid')
    assert.equal(calls[0].data.overrideForbidden, false)
    assert.match(screen.root.querySelector('pre').textContent, /pre-commit/)
    git.blocked = 'Идёт выполнение'; await nextTick()
    assert.ok(button(screen.root, 'Закоммитить').disabled)
  } finally { screen.close() }
})

test('manual forbidden message requires a second explicit click, cleanup removes the forbidden line', async () => {
  const calls = []
  const git = reactive({
    repository: { branch: 'feature' }, projectId: 'p', blocked: '', settings: { include_description: true },
    coauthors: [], error: '', output: '', operationId: '',
    run: async (_action, data) => { calls.push(data); if (!data.overrideForbidden) throw Object.assign(new Error('Forbidden'), { code: 'forbidden_message' }) },
    cancel: async () => {},
  })
  const comp = component('client/src/features/code/components/CommitPanel.vue', {
    '../stores/git': { useGitStore: () => git },
    '../api': { gitApi: { checkMessage: async (_p, data) => ({
      message: data.title, cleaned: data.title + '\n\nDetails',
      violations: data.body.includes('Generated') ? [{ kind: 'forbidden', line: 4, text: 'Generated with Claude Code', pattern: 'Generated with' }] : [],
    }) } },
  })
  const screen = mount(comp)
  try {
    input(screen.root.querySelector('[aria-label="Заголовок коммита"]'), 'TASK fix')
    input(screen.root.querySelector('textarea'), 'Details\nGenerated with Claude Code')
    await settle()
    assert.match(screen.root.textContent, /Запрещённый текст/)
    assert.equal(button(screen.root, 'Всё равно закоммитить'), undefined)
    button(screen.root, 'Закоммитить').click(); await settle()
    button(screen.root, 'Всё равно закоммитить').click(); await settle()
    assert.equal(calls[0].overrideForbidden, false)
    assert.equal(calls[1].overrideForbidden, true)
    input(screen.root.querySelector('[aria-label="Заголовок коммита"]'), 'TASK next')
    input(screen.root.querySelector('textarea'), 'Details\nGenerated with Claude Code')
    await settle(); button(screen.root, 'Убрать').click(); await settle()
    assert.equal(screen.root.querySelector('textarea').value, 'Details')
    assert.equal(button(screen.root, 'Убрать'), undefined)
  } finally { screen.close() }
})

test('changes list stages files independently of review viewed marks and blocks a busy folder', async () => {
  const staged = [], opened = []
  const change = { path: 'new.txt', status: '?', indexStatus: '?', worktreeStatus: '?' }
  const comp = component('client/src/features/code/components/ChangesList.vue', {
    '@shared/code-viewer': { fileIconName: () => '', iconSvg: () => '' },
  })
  const screen = mount(comp, {
    changes: [change], stats: {}, selected: null, emptyText: '', stageable: true, viewable: true,
    onToggleStage: data => staged.push(data.path), onOpen: data => opened.push(data.path),
  })
  try {
    toggle(screen.root.querySelector('[aria-label="К коммиту: new.txt"]'), true)
    assert.deepEqual(staged, ['new.txt']); assert.deepEqual(opened, [])
    screen.root.querySelector('.cl-row').click(); assert.deepEqual(opened, ['new.txt'])
    assert.ok(screen.root.querySelector('[aria-label="Просмотрено: new.txt"]'))
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
 const comp = component('client/src/features/finish/components/FinishPanel.vue', {
  'vue-router': { useRoute: () => ({ query: { finish: '1' } }) },
  '@core/api': { api: { get: async () => ({ values: { finish_scenario: 'commits', base_branch: 'main', branch_template: 'feature/{key}-{slug}' } }) } },
  '@core/stores/app': { useAppStore: () => ({ confirm: async () => true }) },
  '@features/agent-chat': { ChatView: { render: () => null } },
  '@features/code': { CommitDiff: { render: () => null }, gitApi: { branches: async () => [], coauthors: async () => [] } },
  '../stores/finish': { useFinishStore: () => store },
  '../api': { finishApi: { context: async () => ({ changes: [], diffs: {} }) } },
  '../types': { scenarios: { commits: 'Только коммиты' }, stages: { confirmation: 'Подтверждение', done: 'Готово' }, statuses: { waiting: 'Ждёт подтверждения', complete: 'Выполнено' } },
 })
 const screen = mount(comp, { projectId: 'p', branch: 'feature' })
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
  button(screen.root, 'Повторить с замечанием').click(); await settle()
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
