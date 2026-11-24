const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { window } = require('linkedom').parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'ShadowRoot']) global[key] = window[key]
window.HTMLElement.prototype.scrollIntoView = function () { this.scrolled = true }
window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 30, width: 200, height: 30 })
global.getComputedStyle = window.getComputedStyle = () => ({ transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s' })
// Match browser element tags so Vue does not proxy linkedom's internal linked list.
Object.defineProperty(window.HTMLElement.prototype, Symbol.toStringTag, { value: 'HTMLElement' })
global.requestAnimationFrame = callback => setTimeout(callback, 0)
global.cancelAnimationFrame = clearTimeout
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', {
  configurable: true, get() { return this.testValue ?? '' }, set(value) { this.testValue = String(value) },
})
const { createApp, h, reactive, nextTick } = require('vue')
const { createPinia } = require('pinia')
const serverListeners = new Set()
global.subscribeTestEvent = callback => {
  serverListeners.add(callback)
  return () => serverListeners.delete(callback)
}
global.ResizeObserver = class { observe() {} disconnect() {} }
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const { build } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
const compiled = (async () => {
  const bundle = await build({
    stdin: { contents: `
      export { default as CodeTab } from './client/src/features/code/views/CodeTab.vue'
      export { useCodeStore } from './client/src/features/code/stores/code'
      export { useSidePanelStore } from './client/src/features/code/stores/side-panel'
      export { default as WorkStages } from './client/src/features/tasks/components/WorkStages.vue'
      export { default as WorkPreparing } from './client/src/features/tasks/components/WorkPreparing.vue'
      export { default as ExecutionBranch } from './client/src/features/tasks/components/ExecutionBranch.vue'
      export { default as ChangeWorkBranch } from './client/src/features/tasks/components/ChangeWorkBranch.vue'
      export { default as StepPicker } from './client/src/features/tasks/components/StepPicker.vue'
      export { TaskQueueKey } from './client/src/features/tasks/composables/useTaskQueue'
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
      build.onLoad({ filter: /features[\\/]code[\\/]stores[\\/]review-agent\.ts$/ }, () => ({
        contents: 'export const useReviewAgentStore = () => ({ work: null, session: null })', loader: 'ts',
      }))
      build.onLoad({ filter: /features[\\/]finish[\\/]index\.ts$/ }, () => ({
        contents: 'export const FinishPanel = { render: () => null }; export const useFinishStore = () => ({ run: null }); export const finishStages = {}', loader: 'ts',
      }))
      build.onLoad({ filter: /features[\\/]task-mr[\\/]index\.ts$/ }, () => ({
        contents: 'export const TaskMrPanel = { render: () => null }', loader: 'ts',
      }))
      build.onLoad({ filter: /node_modules[\\/]vue-router[\\/]/ }, () => ({
        contents: 'export const useRoute = () => ({ query: {} })', loader: 'ts',
      }))
      // Agent launch and review have their own suites; keep the real document renderer and API.
      build.onLoad({ filter: /features[\\/]agent-chat[\\/]index\.ts$/ }, () => ({
        contents: "export { writeMentionDrag } from './utils/mention-drag'; export { default as MessageMarkdown } from '../../shared/markdown/MessageMarkdown.vue'; export const NewChatPanel = { render: () => null }; export const useComposerReveal = () => {}; export const useChatStore = () => ({ agentOptions: { 'test-agent': {} }, fetchAgentOptions: async () => {} }); export const modelAndEffort = () => ({ models: [], efforts: [] })", loader: 'ts', resolveDir: path.resolve('client/src/features/agent-chat'),
      }))
      build.onLoad({ filter: /features[\\/]agents[\\/]index\.ts$/ }, () => ({ contents: "export { useAgentsStore } from './stores/agents'; export const ensureAgentCli = async () => ({ installed: true, state: 'done' }); export const getAgentInstallMode = async () => 'ask'", loader: 'ts', resolveDir: path.resolve('client/src/features/agents') }))
      build.onLoad({ filter: /features[\\/]code[\\/]index\.ts$/ }, () => ({ contents: "export { gitApi, codeApi } from './api'", loader: 'ts', resolveDir: path.resolve('client/src/features/code') }))
      build.onLoad({ filter: /core[\\/]api[\\/]events\.ts$/ }, () => ({
        contents: 'export const onServerEvent = callback => global.subscribeTestEvent(callback); export const sendServerMessage = () => {}', loader: 'ts',
      }))
      build.onLoad({ filter: /shared[\\/]code-viewer[\\/]index\.ts$/ }, args => ({
        // Keep CodeTab, FileViewer and their stores real; observe the public renderer boundary.
        contents: `export * from './find'; export { fileIconName, iconSvg } from './file-icons';
          export { parseUnifiedDiff } from './diff-model';
          import { h, ref } from 'vue';
          export const FileTree = { render: () => null };
          export const CodeView = { props: ['file', 'mode'], setup(props, { expose }) {
            const target = ref(null);
            expose({ scrollToLine(line, side) { target.value = { line, side } } });
            return () => h('div', { 'data-viewer-path': props.file.path, 'data-viewer-mode': props.mode,
              'data-viewer-line': target.value?.line, 'data-viewer-side': target.value?.side }, props.file.content);
          } };`, loader: 'ts', resolveDir: path.dirname(args.path),
      }))
      build.onLoad({ filter: /\.vue$/ }, args => {
        if (/[\\/]features[\\/]code[\\/]components[\\/]/.test(args.path)
          && !['SearchPanel.vue', 'FileViewer.vue', 'CodeFileTabs.vue'].includes(path.basename(args.path))) {
          return { contents: 'export default { render: () => null }', loader: 'ts' }
        }
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

test('failed work preparation shows the cause and a retry action', async () => {
  const { WorkPreparing } = await compiled
  let retries = 0
  const props = reactive({ error: 'Could not resolve host: corporate-git', retryable: true, retrying: false, onRetry: () => { retries++ } })
  const view = mount(WorkPreparing, props)
  try {
    assert.match(document.body.textContent, /Could not resolve host: corporate-git/)
    assert.match(document.body.textContent, /VPN/)
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Повторить подготовку'))
    assert.ok(retry)
    retry.click(); await flush()
    assert.equal(retries, 1)
    props.retrying = true; await flush()
    assert.equal(retry.disabled, true)
  } finally { view.unmount() }
})
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
  for (const event of ['complete', 'skip', 'select', 'reload', 'changed', 'close']) if (Component.emits?.includes(event)) {
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

test('project search recovers from an empty stream, opens a matching line and updates its status on a file event', async () => {
  const { CodeTab, useCodeStore, useSidePanelStore } = await compiled
  const path = 'src/result.ts'
  let files = [path], store, tabs
  global.fetch = async url => {
    const { pathname, searchParams } = new URL(url, 'http://localhost')
    if (pathname.endsWith('/search')) {
      const rows = searchParams.get('q') === 'needle'
        ? [{ type: 'match', path, line: 7, text: 'the needle' }]
        : []
      return new Response([...rows, { type: 'done', matches: rows.length, files: rows.length, truncated: false }]
        .map(row => JSON.stringify(row)).join('\n') + '\n')
    }
    const data = { files, changes: [], stats: {}, tree: [], current: null, repository: null,
      branches: [], settings: {}, coauthors: [], conflicts: null,
      file: { path, kind: 'text', size: 20, content: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nthe needle\n' } }
    return Response.json(data[pathname.split('/').pop()])
  }
  const view = mount({
    setup() {
      store = useCodeStore()
      tabs = useSidePanelStore()
      return () => h(CodeTab, { projectId: 'p' })
    },
  }, {})
  async function search(query) {
    const input = document.querySelector('input[placeholder="Поиск по проекту"]')
    input.value = query
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await nextTick()
    const enter = new window.Event('keydown', { bubbles: true, cancelable: true })
    enter.key = 'Enter'
    input.dispatchEvent(enter)
    await flush()
  }
  try {
    await flush()
    await click('Поиск')
    assert.match(document.body.textContent, /Введите запрос/)
    await search('absent')
    assert.match(document.body.textContent, /Ничего не найдено/)
    assert.equal(document.querySelector('.ct-center [role=tab]'), null)
    await search('needle')
    assert.match(document.body.textContent, /1 совпадение в 1 файле/)
    const result = [...document.querySelectorAll('button')].find(button => button.textContent.includes('the needle'))
    assert.ok(result)
    result.click()
    await flush()
    assert.equal(store.selectedPath, path)
    assert.equal(tabs.mainPlace('p', null).active, path)
    assert.match(document.querySelector('.ct-center [role=tab][aria-selected=true]').textContent, /result\.ts/)
    const viewer = document.querySelector('[data-viewer-path]')
    assert.equal(viewer.getAttribute('data-viewer-path'), path)
    assert.equal(viewer.getAttribute('data-viewer-mode'), 'file')
    assert.equal(viewer.getAttribute('data-viewer-line'), '7')
    assert.equal(viewer.getAttribute('data-viewer-side'), 'new')

    files = [path, 'src/needle.ts']
    for (const listener of serverListeners) listener({ type: 'code:changed', projectId: 'p' })
    await new Promise(resolve => setTimeout(resolve, 110))
    await flush()
    assert.match(document.body.textContent, /1 по имени · 1 совпадение/)
  } finally {
    view.unmount()
    store.stop()
    delete global.fetch
  }
})

test('task document editors restore both independent drafts after switching tasks', async () => {
  const { MaterialPanel } = await compiled
  const view = mount(MaterialPanel, { ...materialProps(), taskId: 'a', material: material('Source A') })
  const select = async (taskId, source) => {
    Object.assign(view.props, { taskId, material: material(source) })
    await flush()
  }
  try {
    await click('Редактировать вручную')
    assert.equal(document.querySelector('textarea').value, 'Source A')
    await type('Draft A')
    await select('b', 'Source B')
    assert.equal(document.querySelector('textarea'), null)
    await click('Редактировать вручную')
    assert.equal(document.querySelector('textarea').value, 'Source B')
    await type('Draft B')
    for (const [task, source, draft] of [['a', 'Source A', 'Draft A'], ['b', 'Source B', 'Draft B']]) {
      await select(task, source)
      assert.equal(document.querySelector('textarea').value, draft)
    }
  } finally { view.unmount() }
})

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
      [{ workDone: true, sessions: [{ role: kind === 'errand' ? 'errand' : 'executor', status: 'complete' }] }, 'check', offset + 1],
      [{ finish: { status: 'running' } }, 'check', offset + 1],
      [{ finish: { status: 'complete' } }, 'check', offset + 1],
      [{ task: { ...task, status: 'done' } }, 'done', workStagesOf(task).length],
    ]
    for (const [input, expectedStage, index] of cases) {
      const state = computeWorkState({ task, sessions: [{ role: 'executor', status: 'ready' }], ...input })
      assert.equal(state.stage, expectedStage); assert.equal(workStageIndex(task, state), index)
      if (expectedStage === 'check') assert.equal(workTab(state, kind), expectedStage)
    }
  }
})

test('workStageIndex follows the latest preparation stage the developer worked on', async () => {
  const { workStageIndex } = await compiled
  const task = { kind: 'task' }, plan = { stage: 'plan', counts: { steps: 0 } }
  assert.equal(workStageIndex(task, plan, false, stages(['not_started', 'not_started', 'not_started', 'not_started'])), 0)
  assert.equal(workStageIndex(task, plan, false, stages(['draft', 'not_started', 'not_started', 'not_started'])), 0)
  assert.equal(workStageIndex(task, plan, false, stages(['ready', 'not_started', 'not_started', 'not_started'])), 1)
  assert.equal(workStageIndex(task, plan, true, stages(['not_started', 'not_started', 'not_started', 'draft'])), 3, 'a plan draft skips the optional stages')
  assert.equal(workStageIndex(task, plan, true, stages(['skipped', 'skipped', 'skipped', 'ready'])), 4)
})

test('WorkStages marks an unfinished stage with one button, leads on from a finished one, and shows untouched earlier stages as skipped', async () => {
  const { WorkStages, workStagesOf } = await compiled
  const task = { kind: 'task' }
  const view = mount(WorkStages, { task, state: { stage: 'plan', counts: { steps: 0 } }, hasPlan: true, active: 'analysis',
    tabs: workStagesOf(task).map(s => ({ id: s.tab, label: s.label })), stages: stages(['draft', 'not_started', 'not_started', 'draft']), execDone: false })
  const marks = () => [...document.querySelectorAll('.stage-mark')].map(e => e.getAttribute('aria-label'))
  try {
    assert.deepEqual(marks().slice(0, 4), ['Черновик', 'Пропущено', 'Пропущено', 'Текущий этап работы'])
    await click('Завершить этап')
    assert.deepEqual(view.events, [['complete', 'analysis']], 'marking does not switch the stage')
    view.props.stages = stages(['skipped', 'ready', 'draft', 'ready']); view.props.stages[1].changed_since_mark = true
    view.props.execDone = true; await flush()
    assert.deepEqual(marks().slice(0, 5), ['Пропущено', 'Изменён после отметки', 'Черновик', 'Готово', 'Все пункты плана выполнены'])
    view.props.active = 'qa'; view.props.locked = true; await flush()
    assert.equal(button('Завершить этап').disabled, true)
    view.props.active = 'analysis'; await flush()
    await click('Архитектура →'); assert.deepEqual(view.events.at(-1), ['select', 'architecture'], 'a finished stage only leads on')
    view.props.stages = stages(['not_started', 'not_started', 'not_started', 'not_started']); view.props.locked = false; view.props.hasPlan = false; await flush()
    await click('Пропустить этап'); assert.deepEqual(view.events.at(-1), ['skip', 'analysis'], 'an empty optional stage is skipped')
    view.props.active = 'plan'; await flush()
    assert.equal(button('Утвердить план').disabled, true, 'the plan cannot be skipped')
    view.props.drafting = ['plan', 'architecture']; await flush()
    assert.equal(marks()[3], 'Черновик', 'a plan written by hand is in work before the first save')
    assert.equal(button('Утвердить план').title, 'Сначала сохраните документ')
    view.props.active = 'architecture'; await flush()
    assert.equal(marks()[1], 'Черновик', 'so is an architecture written by hand')
    assert.equal(button('Завершить этап').disabled, true)
    view.props.active = 'plan'; view.props.drafting = undefined
    view.props.stages = []; await flush()
    assert.deepEqual(marks().slice(0, 4), ['Не начато', 'Не начато', 'Не начато', 'Не начато'])
  } finally { view.unmount() }
})

test('completed errand execution stays ready and does not pulse during follow-up chat or review', async () => {
  const { WorkStages, workStagesOf, computeWorkState } = await compiled
  const task = { kind: 'errand' }
  const state = status => computeWorkState({ task, workDone: true, sessions: [{ role: 'errand', status }] })
  const view = mount(WorkStages, { task, state: state('complete'), hasPlan: false, active: 'check',
    tabs: workStagesOf(task).map(s => ({ id: s.tab, label: s.label })), stages: [], execDone: false })
  try {
    for (const status of ['starting', 'thinking', 'waiting', 'error', 'ready', 'complete']) {
      view.props.state = state(status); await flush()
      const mark = document.querySelector('[role="tab"] [role="img"]')
      assert.equal(mark.getAttribute('aria-label'), 'Агент выполнил то, что вы написали', status)
      assert.equal(mark.getAnimations?.().length ?? (mark.classList.contains('live') ? 1 : 0), 0, status)
    }
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

test('MaterialPanel shows the identifier format and inserts the next number at the cursor', async () => {
  const { MaterialPanel } = await compiled
  const proto = window.HTMLTextAreaElement.prototype
  proto.setSelectionRange = function (start) { this.selectionStart = start }
  const view = mount(MaterialPanel, { ...materialProps(), type: 'qa', material: material('**Q1** A\n\n**Q5** Removed later') })
  try {
    await click('Редактировать вручную'); await type('**Q1** A\n```\n**Q9** Example\n```\nTail')
    assert.equal(button('Q1').getAttribute('title'), 'Скопировать ссылку [[qa#Q1]]')
    assert.equal([...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Q9'), false)
    document.querySelector('textarea').selectionStart = '**Q1** A'.length
    await click('+ Q6')
    assert.equal(document.querySelector('textarea').value, '**Q1** A\n\n**Q6** \n```\n**Q9** Example\n```\nTail')
    assert.equal(document.querySelector('dl'), null)
    await click('Правила'); assert.ok(document.querySelector('dl'))
    await click('Скрыть правила'); assert.equal(document.querySelector('dl'), null)
  } finally { view.unmount(); delete proto.setSelectionRange }
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


test('architecture completion makes empty QA current while a preparation reviewer finishes', async () => {
  const { WorkStages, workStagesOf, computeWorkState, workStageIndex } = await compiled
  const task = { kind: 'task', status: 'open' }
  const summary = stages(['ready', 'ready', 'not_started', 'not_started'])
  for (const role of ['material-author', 'plan-reviewer', 'planner']) {
    const state = computeWorkState({ task, sessions: [{ role, status: 'thinking' }] })
    assert.equal(workStageIndex(task, state, false, summary), 2)
    const view = mount(WorkStages, { task, state, hasPlan: false, active: 'qa',
      tabs: workStagesOf(task).map(s => ({ id: s.tab, label: s.label })), stages: summary, execDone: false })
    try {
      const marks = [...document.querySelectorAll('.stage-mark')]
      assert.ok(marks[2].classList.contains('draft'), 'QA is the current stage')
      assert.ok(marks[3].classList.contains('empty'), 'the plan is still ahead')
      assert.ok(marks[4].classList.contains('empty'), 'execution has not started')
    } finally { view.unmount() }
  }
})

test('an erased approved plan returns to the plan stage and cannot advance to execution', async () => {
  const { WorkStages, workStageIndex, workStagesOf } = await compiled
  const task = { kind: 'task' }, state = { stage: 'plan', counts: { steps: 0 } }
  for (const changed of [false, true]) {
    const summary = stages(['skipped', 'skipped', 'skipped', 'ready'])
    summary[3].changed_since_mark = changed
    const current = workStageIndex(task, state, false, summary)
    assert.equal(workStagesOf(task)[current].tab, 'plan', 'reopening an empty plan stays on Plan')
    const view = mount(WorkStages, { task, state, hasPlan: false, active: 'plan',
      tabs: workStagesOf(task).map(s => ({ id: s.tab, label: s.label })), stages: summary, execDone: false })
    try {
      const executionTab = document.querySelectorAll('[role="tab"]')[4]
      assert.equal(executionTab.getAttribute('aria-disabled'), 'true')
      const next = document.querySelector('.stage-actions button')
      assert.equal(next.disabled, true)
      next.click(); await flush()
      assert.deepEqual(view.events, [])
      view.props.hasPlan = true; await flush()
      assert.equal(executionTab.hasAttribute('aria-disabled'), false)
      assert.equal(next.disabled, false)
      assert.equal(workStageIndex(task, state, true, summary), 4)
    } finally { view.unmount() }
  }
})
test('a saved plan advances the current stage and enables completion with a stale preparation summary', async () => {
  const { WorkStages, workStageIndex, workStagesOf } = await compiled
  const task = { kind: 'task' }, state = { stage: 'plan', counts: { steps: 0 } }
  const summary = stages(['not_started', 'not_started', 'not_started', 'not_started'])
  const view = mount(WorkStages, { task, state, hasPlan: false, active: 'plan',
    tabs: workStagesOf(task).map(s => ({ id: s.tab, label: s.label })), stages: summary, execDone: false })
  try {
    const next = document.querySelector('.stage-actions button')
    assert.equal(next.disabled, true)
    // The HTTP save can return before any WebSocket event or summary refresh.
    view.props.hasPlan = true; await flush()
    assert.equal(workStageIndex(task, state, true, summary), 3)
    assert.deepEqual([...document.querySelectorAll('.stage-mark')].slice(0, 4).map(e => e.getAttribute('aria-label')),
      ['Пропущено', 'Пропущено', 'Пропущено', 'Текущий этап работы'])
    assert.equal(next.disabled, false)
    next.click(); await flush()
    assert.deepEqual(view.events, [['complete', 'plan']], 'a manual save does not implicitly approve the plan')
  } finally { view.unmount() }
})

test('saving directly on architecture, QA or plan leaves preceding empty stages skipped', async () => {
  const { WorkStages, workStageIndex, workStagesOf } = await compiled
  const task = { kind: 'task' }, state = { stage: 'plan', counts: { steps: 0 } }
  const order = ['analysis', 'architecture', 'qa', 'plan']
  for (const stage of ['architecture', 'qa', 'plan']) {
    const index = order.indexOf(stage)
    const summary = stages(order.map(id => id === stage ? 'draft' : 'not_started'))
    const view = mount(WorkStages, { task, state, hasPlan: stage === 'plan', active: stage,
      tabs: workStagesOf(task).map(s => ({ id: s.tab, label: s.label })), stages: summary, execDone: false })
    try {
      assert.equal(workStageIndex(task, state, stage === 'plan', summary), index)
      const marks = [...document.querySelectorAll('.stage-mark')]
      assert.ok(marks.slice(0, index).every(e => e.getAttribute('aria-label') === 'Пропущено'))
      assert.equal(marks[index].getAttribute('aria-label'), 'Текущий этап работы')
      const next = document.querySelector('.stage-actions button')
      assert.equal(next.disabled, false)
      next.click(); await flush()
      assert.deepEqual(view.events, [['complete', stage]])
    } finally { view.unmount() }
  }
})

test('execution steps can be selected by click or keyboard and added to the queue', async () => {
  const { StepPicker, TaskQueueKey } = await compiled
  const { ref } = require('vue')
  const calls = []
  const queue = { frozen: ref(false), stages: ref([]), assigned: ref(new Set()),
    addSessions: async (...args) => calls.push(args) }
  const plan = { id: 'plan', content: '- [ ] (p1) Manual step', steps: [{ id: 'p1', index: 0, text: 'Manual step', done: false }] }
  const view = mount(StepPicker, { plan, projectId: 'project', taskId: 'task', taskDone: false, defaultAgentId: 'test-agent' },
    app => app.provide(TaskQueueKey, queue))
  try {
    const row = document.querySelector('[role=checkbox]')
    assert.equal(row.getAttribute('aria-checked'), 'false')
    row.click(); await flush()
    assert.equal(row.getAttribute('aria-checked'), 'true')
    const add = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Добавить 1'))
    assert.ok(add)
    assert.equal(add.disabled, false)
    add.click(); await flush()
    assert.deepEqual(calls[0][0].map(s => s.points), [['p1']])
    assert.equal(calls[0][1], 'new')
    assert.equal(row.getAttribute('aria-checked'), 'false')

    const key = new window.Event('keydown', { bubbles: true }); key.key = ' '
    row.dispatchEvent(key); await flush()
    assert.equal(row.getAttribute('aria-checked'), 'true')
    view.props.taskDone = true; await flush()
    row.click(); await flush()
    assert.equal(row.getAttribute('aria-checked'), 'true', 'a closed task cannot change the selection')
    assert.equal(row.getAttribute('aria-disabled'), 'true')
  } finally { view.unmount() }
})

test('a pinned workspace uses the creation branch picker and sends its selected base branch', async () => {
  const { ExecutionBranch } = await compiled
  const requests = []
  const task = { id: 'task', project_id: 'project', status: 'draft', branch_name: 'feature/original' }
  const workspace = { id: 'workspace', project_id: 'project', task_id: 'task', status: 'ready', branch: task.branch_name }
  const updated = { task: { ...task, branch_name: 'feature/new' }, workspace: { ...workspace, branch: 'feature/new' } }
  global.fetch = async (url, options) => {
    requests.push({ url, method: options.method, body: options.body && JSON.parse(options.body) })
    return { ok: true, status: 200, json: async () => url.includes('/switch-branch') ? updated
      : url.includes('/git/settings') ? { branch_prefixes: [], base_branch: 'main' }
      : url.includes('/git/repository') ? { branch: workspace.branch }
      : url.includes('/git/branches') ? [{ name: workspace.branch, remote: false }, { name: 'feature/base', remote: false }]
      : [] }
  }
  const view = mount(ExecutionBranch, { task, workspace, configurable: false,
    modelValue: { place: 'new', branch_name: '', base_branch: '', branch: '' }, lockedReason: '' })
  try {
    await flush()
    assert.equal(document.querySelector('.branch-heading > svg'), null, 'there is no icon beside the heading')
    assert.equal(document.querySelector('.modal'), null, 'branch selection uses the creation popover')
    assert.equal(button('feature/original').disabled, false)
    await click('feature/original')
    assert.ok(requests.some(r => /git\/branches\?workspace=workspace$/.test(r.url)))
    await click('Создать новую')
    let input = document.querySelector('input[aria-label="Имя новой ветки"]')
    input.value = 'feature/new'; input.dispatchEvent(new window.Event('input', { bubbles: true })); await flush()
    document.querySelector('button[aria-haspopup="dialog"]').click(); await flush()
    assert.equal(button('feature/original').disabled, false, 'closing without switching restores the confirmed branch')
    assert.equal(requests.some(r => r.url.includes('/switch-branch')), false)
    await click('feature/original')
    await click('Создать новую')
    input = document.querySelector('input[aria-label="Имя новой ветки"]')
    assert.equal(input.value, '', 'an abandoned new branch is not retained')
    input.value = 'feature/new'; input.dispatchEvent(new window.Event('input', { bubbles: true })); await flush()
    const base = document.querySelector('input[aria-label="Базовая ветка"]')
    base.dispatchEvent(new window.Event('focus')); await flush()
    ;[...document.querySelectorAll('[role="option"]')].find(o => o.textContent === 'feature/base').click(); await flush()
    await click('Переключить')
    const request = requests.find(r => r.url.includes('/switch-branch'))
    assert.match(request.url, /projects\/project\/tasks\/task\/switch-branch$/)
    assert.deepEqual(request.body, { branch: 'feature/new', create: true, base: 'feature/base' })
    assert.deepEqual(view.events, [['changed', updated.task]])
    assert.equal(button('feature/new').disabled, false, 'a successful switch displays the confirmed branch')
    view.props.lockedReason = 'Остановите очередь'; await flush()
    assert.equal(document.querySelector('button[aria-haspopup="dialog"]').disabled, true)
  } finally { view.unmount(); delete global.fetch }
})

test('a rejected branch change keeps the creation popover and chosen branch for retry', async () => {
  const { ChangeWorkBranch } = await compiled
  const task = { id: 'task', project_id: 'project', status: 'draft' }
  const workspace = { id: 'workspace', branch: 'feature/original' }
  const requests = []; let reject = true
  const updated = { task: { ...task, branch_name: 'feature/next' }, workspace: { ...workspace, branch: 'feature/next' } }
  global.fetch = async (url, options) => {
    const post = url.includes('/switch-branch')
    if (post) requests.push(JSON.parse(options.body))
    return { ok: !post || !reject, status: post && reject ? 409 : 200, json: async () => post
      ? reject ? { error: 'Сохраните изменения' } : updated
      : url.includes('/git/settings') ? { branch_prefixes: [], base_branch: 'main' }
      : url.includes('/git/repository') ? { branch: workspace.branch }
      : url.includes('/git/branches') ? [{ name: 'feature/next', remote: false }, { name: 'feature/busy', remote: false }]
      : [] }
  }
  const view = mount(ChangeWorkBranch, { task, workspace, taken: { 'feature/busy': 'other' }, lockedReason: '' })
  try {
    await flush()
    await click('feature/original')
    const input = document.querySelector('input[role="combobox"]')
    input.dispatchEvent(new window.Event('focus')); await flush()
    const options = [...document.querySelectorAll('[role="option"]')]
    assert.equal(options.find(o => o.textContent.includes('feature/busy')).disabled, true)
    options.find(o => o.textContent === 'feature/next').click(); await flush()
    await click('Переключить')
    assert.match(document.querySelector('[role="alert"]').textContent, /Сохраните изменения/)
    assert.deepEqual(view.events, [])
    assert.deepEqual(requests, [{ branch: 'feature/next', create: false }])
    document.querySelector('button[aria-haspopup="dialog"]').click(); await flush()
    assert.equal(button('feature/original').disabled, false, 'closing after a rejected switch restores the current branch')
    await click('feature/original')
    const restored = document.querySelector('input[role="combobox"]')
    assert.equal(restored.value, 'feature/original', 'the unconfirmed selection was discarded')
    restored.dispatchEvent(new window.Event('focus')); await flush()
    ;[...document.querySelectorAll('[role="option"]')].find(o => o.textContent === 'feature/next').click(); await flush()
    view.props.lockedReason = 'Остановите очередь'; await flush()
    assert.equal(button('Переключить').disabled, true)
    view.props.lockedReason = ''; reject = false; await flush()
    await click('Переключить')
    assert.deepEqual(view.events, [['changed', updated]])
    assert.equal(document.querySelector('[role="dialog"]'), null)
  } finally { view.unmount(); delete global.fetch }
})
