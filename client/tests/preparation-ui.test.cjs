const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { window } = require('linkedom').parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'ShadowRoot']) global[key] = window[key]
window.HTMLElement.prototype.scrollIntoView = function () { this.scrolled = true }
// Match browser element tags so Vue does not proxy linkedom's internal linked list.
Object.defineProperty(window.HTMLElement.prototype, Symbol.toStringTag, { value: 'HTMLElement' })
global.requestAnimationFrame = callback => setTimeout(callback, 0)
global.cancelAnimationFrame = clearTimeout
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', {
  configurable: true, get() { return this.testValue ?? '' }, set(value) { this.testValue = String(value) },
})
const { createApp, h, reactive, nextTick } = require('vue')
const { createPinia } = require('pinia')
const { build } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
const compiled = (async () => {
  const bundle = await build({
    stdin: { contents: `
      export { default as WorkStages } from './client/src/features/tasks/components/WorkStages.vue'
      export { default as MaterialPanel } from './client/src/features/tasks/components/MaterialPanel.vue'
      export { default as AnalysisLinks } from './client/src/features/tasks/components/AnalysisLinks.vue'
      export { default as MessageMarkdown } from './client/src/shared/markdown/MessageMarkdown.vue'
      export * from './client/src/features/tasks/utils/work-state'
      export * from './client/src/features/tasks/utils/document-target'
      export { DocumentLinksKey } from './client/src/shared/markdown/documentLinks'
      export { computeWorkState } from './server/core/work/state'
    `, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue', 'pinia'], loader: { '.css': 'empty' },
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core'), '@features': path.resolve('client/src/features') },
    plugins: [{ name: 'vue-test', setup(build) {
      // Agent launch and review have their own suites; keep the real document renderer and API.
      build.onLoad({ filter: /features[\\/]agent-chat[\\/]index\.ts$/ }, () => ({
        contents: "export { default as MessageMarkdown } from '../../shared/markdown/MessageMarkdown.vue'; export const NewChatPanel = { render: () => null }", loader: 'ts', resolveDir: path.resolve('client/src/features/agent-chat'),
      }))
      build.onLoad({ filter: /\.vue$/ }, args => {
        if (['TaskChats.vue', 'PlanReviewPanel.vue'].includes(path.basename(args.path))) return { contents: 'export default { render: () => null }', loader: 'ts' }
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        const contents = descriptor.script || descriptor.scriptSetup
          ? compileScript(descriptor, { id: args.path, inlineTemplate: true }).content
          : compileTemplate({ source: descriptor.template.content, filename: args.path, id: args.path }).code + '\nexport default { render }'
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  const mod = new Module(path.resolve('scripts/.preparation-ui-test.cjs'), module)
  mod.filename = path.resolve('scripts/.preparation-ui-test.cjs'); mod.paths = module.paths
  mod._compile(bundle.outputFiles[0].text, mod.filename)
  return mod.exports
})()
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
test('markdown document links open valid targets and use safe configurable labels', async () => {
  const { MessageMarkdown, DocumentLinksKey } = await compiled
  const opened = []
  const view = mount(MessageMarkdown, { text: '[[valid]] [[missing]]' }, app => app.provide(DocumentLinksKey, {
    exists: target => target === 'valid', open: target => opened.push(target), openLabel: 'Open "document"',
  }))
  try {
    const buttons = [...document.querySelectorAll('button[data-document-target]')]
    assert.equal(buttons.length, 2)
    assert.equal(buttons[0].title, 'Open "document"')
    assert.equal(buttons[1].title, 'Документ не найден')
    assert.equal(buttons[1].disabled, true)
    buttons[0].click(); buttons[1].click()
    assert.deepEqual(opened, ['valid'])
  } finally { view.unmount() }
})
function mount(Component, initial, provide) {
  const props = reactive(initial), events = []
  const listeners = {}
  for (const event of ['complete', 'select', 'reload']) if (Component.emits?.includes(event)) {
    listeners['on' + event[0].toUpperCase() + event.slice(1)] = (...args) => events.push([event, ...args])
  }
  const app = createApp({ render: () => h(Component, { ...props, ...listeners }) })
  app.use(createPinia()); provide?.(app); app.mount('#app')
  return { props, events, unmount: () => app.unmount() }
}
const button = text => {
  const found = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  assert.ok(found, 'button: ' + text); return found
}
async function click(text) { button(text).click(); await flush() }
async function type(text) {
  const input = document.querySelector('textarea'); input.value = text
  input.dispatchEvent(new window.Event('input', { bubbles: true })); await flush()
}
const stages = statuses => ['analysis', 'architecture', 'qa', 'plan'].map((stage, i) => ({ stage, status: statuses[i], changed_since_mark: false }))
const materialProps = () => ({ type: 'architecture', material: null, projectId: 'project', taskId: 'task', lockedReason: '', done: false,
  chats: [], selectedChat: null, initials: {}, launching: false, launchError: '', live: false })
const material = (content, version = 1) => ({ type: 'qa', content, version, author: 'developer' })

test('work-state matches server check, finish and closed transitions for tasks and errands', async () => {
  const { computeWorkState, workStageIndex, workStagesOf, workTab } = await compiled
  for (const kind of ['task', 'errand']) {
    const task = { kind, status: 'draft' }, offset = kind === 'task' ? 4 : 0
    assert.equal(workStageIndex(task, null), 0)
    assert.equal(workStageIndex(task, { stage: 'plan', counts: { steps: 2 } }), 3)
    const cases = [
      [{ sessions: [{ role: 'executor', status: 'thinking' }] }, 'execution', offset],
      [{ sessions: [{ role: 'task-reviewer', status: 'thinking' }] }, 'check', offset + 1],
      [{ remarks: 1 }, 'check', offset + 1],
      [{ sessions: [{ role: 'executor', status: 'complete' }] }, 'check', offset + 1],
      [{ finish: { status: 'running' } }, 'finish', offset + 2],
      [{ finish: { status: 'complete' } }, 'finish', offset + 2],
      [{ task: { ...task, status: 'done' } }, 'done', workStagesOf(task).length],
    ]
    for (const [input, expectedStage, index] of cases) {
      const state = computeWorkState({ task, sessions: [{ role: 'executor', status: 'ready' }], ...input })
      assert.equal(state.stage, expectedStage); assert.equal(workStageIndex(task, state), index)
      if (expectedStage === 'check' || expectedStage === 'finish') assert.equal(workTab(state, kind), expectedStage)
    }
  }
})

test('WorkStages displays legacy drafts, server marks and changed documents without inferring a skip', async () => {
  const { WorkStages, workStagesOf } = await compiled
  const task = { kind: 'task' }
  const view = mount(WorkStages, { task, state: { stage: 'execution', counts: { steps: 1 } }, hasPlan: true, active: 'analysis',
    tabs: workStagesOf(task).map(s => ({ id: s.tab, label: s.label })), stages: stages(['draft', 'not_started', 'not_started', 'draft']), execDone: false })
  const marks = () => [...document.querySelectorAll('.stage-mark')].map(e => e.getAttribute('aria-label'))
  try {
    assert.deepEqual(marks().slice(0, 4), ['Черновик', 'Не начато', 'Не начато', 'Черновик'])
    await click('Завершить и перейти к Архитектура')
    assert.deepEqual(view.events, [['complete', 'analysis']])
    assert.deepEqual(marks().slice(0, 4), ['Черновик', 'Не начато', 'Не начато', 'Черновик'], 'client waits for the server summary')
    view.props.stages = stages(['skipped', 'ready', 'draft', 'ready']); view.props.stages[1].changed_since_mark = true
    view.props.execDone = true; await flush()
    assert.deepEqual(marks().slice(0, 5), ['Пропущено', 'Изменён после отметки', 'Черновик', 'Готово', 'Все пункты плана выполнены'])
    view.props.active = 'qa'; view.props.locked = true; await flush()
    assert.equal(button('Завершить и перейти к План').disabled, true)
    view.props.active = 'analysis'; await flush()
    await click('Перейти к Архитектура'); assert.deepEqual(view.events.at(-1), ['select', 'architecture'])
    view.props.stages = stages(['not_started', 'not_started', 'not_started', 'draft']); view.props.locked = false; await flush()
    assert.equal(button('Завершить и перейти к Архитектура').disabled, true)
    view.props.stages = []; await flush()
    assert.deepEqual(marks().slice(0, 4), ['Не начато', 'Не начато', 'Не начато', 'Черновик'])
  } finally { view.unmount() }
})

test('MaterialPanel offers an optional empty document and blocks editing during a queue or after closure', async () => {
  const { MaterialPanel } = await compiled
  const view = mount(MaterialPanel, materialProps())
  try {
    assert.match(document.body.textContent, /Архитектура необязательна/)
    assert.equal(button('Написать вручную').disabled, false)
    view.props.lockedReason = 'Очередь выполняется'; await flush()
    assert.equal(button('Написать вручную').disabled, true)
    assert.equal(button('▸ Составить с агентом').disabled, true)
    view.props.done = true; await flush()
    assert.equal(document.querySelector('button'), null)
    assert.match(document.body.textContent, /По задаче не было этого документа/)
  } finally { view.unmount() }
})

test('MaterialPanel preserves rejected edits, reloads a new version and retries with its version', async () => {
  const { MaterialPanel } = await compiled
  const requests = []; let reject = true
  global.fetch = async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) })
    return { ok: !reject, status: reject ? 409 : 200, json: async () => reject ? { error: 'Документ уже изменён' } : material('saved', 3) }
  }
  const view = mount(MaterialPanel, { ...materialProps(), type: 'qa', material: material('**Q3** Old') })
  try {
    await click('Редактировать вручную'); await type('**Q3** My draft'); await click('Сохранить')
    assert.equal(document.querySelector('textarea').value, '**Q3** My draft')
    assert.match(document.querySelector('[role=alert]').textContent, /Документ уже изменён/)
    assert.deepEqual(requests[0].body, { content: '**Q3** My draft', expected_version: 1 })
    assert.match(requests[0].url, /\/projects\/project\/tasks\/task\/materials\/qa$/)
    assert.equal(requests[0].method, 'PUT'); assert.deepEqual(view.events, [['reload']])
    view.props.material = material('**Q3** New server version', 2); await flush()
    assert.equal(document.querySelector('textarea').value, '**Q3** My draft')
    assert.match(document.body.textContent, /Документ изменился/)
    await click('Взять актуальный'); assert.equal(document.querySelector('textarea').value, '**Q3** New server version')
    await click('Вернуть мой текст'); assert.equal(document.querySelector('textarea').value, '**Q3** My draft')
    view.props.lockedReason = 'Агент работает'; await flush()
    assert.equal(button('Сохранить').disabled, true)
    assert.equal(requests.length, 1)
    view.props.lockedReason = ''; reject = false; await flush(); await click('Сохранить')
    assert.equal(requests[1].body.expected_version, 2)
    assert.equal(document.querySelector('textarea'), null)
    assert.deepEqual(view.events, [['reload'], ['reload']])
  } finally { view.unmount(); delete global.fetch }
})

test('AnalysisLinks resolves QA identifiers and legacy files and reacts when a document disappears', async () => {
  const { AnalysisLinks, DocumentLinksKey, resolveDocumentTarget } = await compiled
  const sources = reactive({ sections: [{ slug: 'requirements', files: [{ name: 'notes.md' }] }], materials: { architecture: material('**D1** Decision'), qa: material('**Q3** Criterion') } })
  const opened = []
  const view = mount(AnalysisLinks, { text: 'Check [[qa#Q3]], [[qa#Q9]], [[qa]], [[requirements/notes.md]], [[requirements/missing.md]] and [[architecture]].' }, app => {
    app.provide(DocumentLinksKey, { exists: target => !!resolveDocumentTarget(target, sources.sections, sources.materials), open: target => opened.push(target) })
  })
  try {
    assert.equal(button('qa#Q3').disabled, false); assert.equal(button('qa#Q9').disabled, true)
    assert.equal(button('requirements/notes.md').disabled, false); assert.equal(button('requirements/missing.md').disabled, true)
    await click('qa#Q3'); await click('requirements/notes.md'); await click('architecture')
    assert.deepEqual(opened, ['qa#Q3', 'requirements/notes.md', 'architecture'])
    assert.deepEqual(resolveDocumentTarget('qa#Q3', sources.sections, sources.materials), { type: 'qa', identifier: 'Q3' })
    assert.equal(resolveDocumentTarget('qa#Q3#extra', sources.sections, sources.materials), null)
    sources.materials.qa = material('Text **Q9**\n````md\n**Q9** Example\n```\n**Q8** Still fenced\n````\n## **Q3** Criterion')
    assert.equal(resolveDocumentTarget('qa#Q9', sources.sections, sources.materials), null)
    assert.equal(resolveDocumentTarget('qa#Q8', sources.sections, sources.materials), null)
    assert.equal(resolveDocumentTarget('qa#Q3', sources.sections, sources.materials)?.identifier, 'Q3')
    sources.materials.qa = null; await flush()
    assert.equal(button('qa#Q3').disabled, true); assert.equal(button('qa').disabled, true)
  } finally { view.unmount() }
})

test('MaterialPanel opens and highlights a referenced criterion in the saved document', async () => {
  const { MaterialPanel } = await compiled
  const view = mount(MaterialPanel, { ...materialProps(), type: 'qa', material: material('**Q3** Criterion') })
  try {
    view.props.openedIdentifier = 'Q3'; await flush(); await flush()
    const highlighted = document.querySelector('.material-hl')
    assert.equal(highlighted?.textContent, 'Q3'); assert.equal(highlighted.scrolled, true)
  } finally { view.unmount() }
})
