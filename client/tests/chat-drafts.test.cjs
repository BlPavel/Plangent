const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { window } = require('linkedom').parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'ShadowRoot']) global[key] = window[key]
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', {
  configurable: true,
  get() { return this.testValue ?? '' },
  set(value) { this.testValue = String(value) },
})
window.HTMLTextAreaElement.prototype.setSelectionRange = function(start, end) { this.selectionStart = start; this.selectionEnd = end }
const { createApp, h, reactive, nextTick } = require('vue')
global.requestAnimationFrame = fn => setTimeout(fn, 0)
global.cancelAnimationFrame = clearTimeout
const { createPinia } = require('pinia')
const { build } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')

const compiled = (async () => {
  const entry = path.resolve('client/src/features/agent-chat/components/ChatComposer.vue')
  const bundle = await build({
    entryPoints: [entry], bundle: true, write: false, loader: { '.css': 'empty', '.md': 'text' }, platform: 'node', format: 'cjs', external: ['vue', 'pinia'],
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        let contents = compileScript(descriptor, { id: args.path, inlineTemplate: true }).content
        if (args.path === entry) contents = "import { useDraftsStore } from '@core/stores/drafts';\n" + contents;
        if (args.path === entry) contents += '\nexport { useDraftsStore as testDraftsStore }; export { writeMentionDrag, readMentionDrag } from "../utils/mention-drag"'
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  const mod = new Module(path.resolve('scripts/.chat-drafts-test.cjs'), module)
  mod.filename = path.resolve('scripts/.chat-drafts-test.cjs')
  mod.paths = module.paths
  mod._compile(bundle.outputFiles[0].text, mod.filename)
  return mod.exports
})()

async function harness(initialProps) {
  const { default: Composer, testDraftsStore } = await compiled
  const pinia = createPinia()
  const props = reactive({ projectId: 'project-a', ...initialProps })
  const sent = [], errors = []
  let app
  function mount() {
    app = createApp({ render: () => h(Composer, { ...props, onSend: content => sent.push(content), onError: message => errors.push(message) }) })
    app.use(pinia)
    app.mount('#app')
  }
  mount()
  return {
    props, sent, errors, store: { ...testDraftsStore(pinia), get: (key) => testDraftsStore(pinia).get(key, () => ({ text: '', touched: false, attachments: [], mentions: new Map() })) },
    unmount: () => app.unmount(),
    remount: async () => { app.unmount(); mount(); await nextTick() },
    value: () => document.querySelector('textarea').value,
    type: async value => {
      const input = document.querySelector('textarea')
      input.value = value
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      await nextTick()
    },
    submit: async () => {
      document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await nextTick()
    },
  }
}

test('new and existing chats restore exact unsent text after leaving the view', async () => {
  for (const draftKey of ['new-chat:project-a', 'session:chat-a']) {
    const chat = await harness({ draftKey })
    try {
      await chat.type('  Первая строка\nВторая строка  ')
      assert.equal(document.querySelector('button[type=submit]').disabled, false)
      await chat.remount()
      assert.equal(chat.value(), '  Первая строка\nВторая строка  ')
      await chat.type('')
      assert.equal(document.querySelector('button[type=submit]').disabled, true)
      await chat.remount()
      assert.equal(chat.value(), '', 'deleting text does not resurrect a previous draft')
    } finally { chat.unmount() }
  }
})

test('composer restores draft height when a hidden tab appears and when its width changes', async () => {
  const previousObserver = global.ResizeObserver
  const observers = []
  global.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(element) { this.element = element }
    disconnect() { this.disconnected = true }
    resize(width) { this.callback([{ contentRect: { width } }]) }
  }
  const chat = await harness({ draftKey: 'session:resize' })
  try {
    await nextTick()
    const input = document.querySelector('textarea')
    const observer = observers.find(item => item.element?.tagName === 'TEXTAREA')
    let fullHeight = 180
    Object.defineProperty(input, 'scrollHeight', { get: () => input.testHidden ? 0 : fullHeight })
    await chat.type('A long draft\nwith several lines')
    assert.equal(input.style.height, '180px')
    observer.resize(500)
    input.testHidden = true
    observer.resize(0)
    chat.store.get('session:resize').text += '\nAnother line while hidden'
    await nextTick()
    assert.equal(input.style.height, '180px', 'hidden updates preserve the last measured height')
    input.testHidden = false
    fullHeight = 220
    observer.resize(500)
    assert.equal(input.style.height, '220px', 'showing the tab restores height without typing')
    fullHeight = 320
    observer.resize(300)
    assert.equal(input.style.height, '240px', 'narrower fields grow up to the height limit')
    fullHeight = 100
    observer.resize(700)
    assert.equal(input.style.height, '100px', 'wider fields shrink to fit the draft')
    fullHeight = 44
    await chat.type('')
    assert.equal(input.style.height, '44px', 'clearing the draft restores the minimum height')
    chat.unmount()
    assert.equal(observer.disconnected, true)
  } finally {
    if (document.querySelector('textarea')) chat.unmount()
    global.ResizeObserver = previousObserver
  }
})

test('deleting a session removes its draft and selection without touching other chats', async () => {
  const chat = await harness({ draftKey: 'new-chat:project-a' })
  try {
    chat.store.get('session:chat-a').text = 'Удаляемый черновик'
    chat.store.get('session:chat-b').text = 'Другой черновик'
    
    
    await chat.remount()
    chat.store.clear('session:chat-a')
    assert.equal(chat.store.drafts['session:chat-a'], undefined)
    assert.equal(chat.store.get('session:chat-b').text, 'Другой черновик')
  } finally { chat.unmount() }
})

test('switching chats and projects keeps each draft separate, including reused components', async () => {
  const chat = await harness({ draftKey: 'new-chat:project-a' })
  try {
    await chat.type('Новый чат проекта A')
    for (const [projectId, draftKey, text] of [
      ['project-a', 'session:chat-a', 'Существующий чат A'],
      ['project-a', 'session:chat-b', 'Существующий чат B'],
      ['project-b', 'new-chat:project-b', 'Новый чат проекта B'],
    ]) {
      Object.assign(chat.props, { projectId, draftKey })
      await nextTick()
      assert.equal(chat.value(), '')
      await chat.type(text)
    }
    Object.assign(chat.props, { projectId: 'project-a', draftKey: 'new-chat:project-a' })
    await nextTick()
    assert.equal(chat.value(), 'Новый чат проекта A')
    chat.props.draftKey = 'session:chat-a'
    await nextTick()
    assert.equal(chat.value(), 'Существующий чат A')
  } finally { chat.unmount() }
})

test('draft overrides initial text on remount and sending clears only the active draft', async () => {
  const chat = await harness({ draftKey: 'session:chat-a', initialText: 'Предложенный текст' })
  try {
    assert.equal(chat.value(), 'Предложенный текст')
    await chat.type('Исправленный текст')
    await chat.remount()
    assert.equal(chat.value(), 'Исправленный текст')
    chat.store.get('session:chat-b').text = 'Другой черновик'
    await chat.submit()
    assert.deepEqual(chat.sent, [[{ type: 'text', text: 'Исправленный текст' }]])
    await chat.remount()
    assert.equal(chat.value(), '')
    assert.equal(chat.store.get('session:chat-b').text, 'Другой черновик')
  } finally { chat.unmount() }
})

test('attachments and mention links survive remount and are cleared with the sent text', async () => {
  const chat = await harness({ draftKey: 'session:chat-a' })
  try {
    const draft = chat.store.get('session:chat-a')
    draft.mentions.set('src/index.ts', 'file:///project/src/index.ts')
    const block = { type: 'resource', resource: { uri: 'file:///note.txt', text: 'Notes' } }
    draft.attachments.push({ name: 'note.txt', block })
    await chat.type('Проверь @src/index.ts')
    await chat.remount()
    assert.ok(document.querySelector('.chip-name').textContent.includes('note.txt'))
    await chat.submit()
    assert.deepEqual(chat.sent[0], [
      { type: 'text', text: 'Проверь @src/index.ts' },
      { type: 'resource_link', uri: 'file:///project/src/index.ts', name: 'src/index.ts' },
      block,
    ])
    assert.equal(draft.attachments.length, 0)
    assert.equal(draft.mentions.size, 0)
  } finally { chat.unmount() }
})

function transfer() {
  const values = new Map()
  return { files: [], get types() { return [...values.keys()] }, setData: (type, value) => values.set(type, value), getData: type => values.get(type) ?? '' }
}
function dragEvent(type, data) {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  event.dataTransfer = data
  document.querySelector('form').dispatchEvent(event)
  return event
}
const flushDrop = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }

test('dragged range and directory resolve in the workspace, survive remount and send file links', async () => {
  const { writeMentionDrag } = await compiled
  const chat = await harness({ draftKey: 'drop:work', workspaceId: 'work' })
  const previousFetch = global.fetch, calls = []
  global.fetch = async url => {
    calls.push(url)
    const path = new URL(url, 'http://localhost').searchParams.get('path').replace(/\/$/, '')
    return { ok: true, json: async () => [{ path: path + (path === 'src' ? '/' : ''), dir: path === 'src', uri: 'file:///work/' + path }] }
  }
  try {
    await chat.type('Check here')
    document.querySelector('textarea').setSelectionRange(6, 10)
    const range = transfer()
    writeMentionDrag(range, { projectId: 'project-a', workspaceId: 'work', path: 'src/a.ts', dir: false, startLine: 12, endLine: 30 })
    const over = dragEvent('dragover', range)
    assert.equal(over.defaultPrevented, true)
    await nextTick()
    assert.ok(document.querySelector('form').classList.contains('dragging'))
    dragEvent('drop', range); await flushDrop()
    assert.equal(chat.value(), 'Check @src/a.ts:12-30 ')
    assert.equal(document.querySelector('form').classList.contains('dragging'), false)
    const folder = transfer()
    writeMentionDrag(folder, { projectId: 'project-a', workspaceId: 'work', path: 'src', dir: true })
    dragEvent('drop', folder); await flushDrop()
    assert.equal(chat.value(), 'Check @src/a.ts:12-30 @src/ ')
    for (const url of calls) assert.equal(new URL(url, 'http://localhost').searchParams.get('workspace'), 'work')
    await chat.remount(); await chat.submit()
    assert.deepEqual(chat.sent[0], [
      { type: 'text', text: 'Check @src/a.ts:12-30 @src/' },
      { type: 'resource_link', uri: 'file:///work/src/a.ts', name: 'src/a.ts' },
      { type: 'resource_link', uri: 'file:///work/src', name: 'src' },
    ])
    assert.deepEqual(chat.errors, [])
  } finally { global.fetch = previousFetch; chat.unmount() }
})

test('foreign folders, invalid payloads and late mention responses do not change the current draft', async () => {
  const { writeMentionDrag, readMentionDrag } = await compiled
  const chat = await harness({ draftKey: 'drop:first', workspaceId: 'work' })
  const previousFetch = global.fetch
  let resolve
  global.fetch = () => new Promise(done => { resolve = done })
  try {
    const foreign = transfer()
    writeMentionDrag(foreign, { projectId: 'project-a', workspaceId: null, path: 'a.ts', dir: false })
    dragEvent('drop', foreign); await flushDrop()
    assert.equal(chat.errors.length, 1)
    assert.equal(chat.value(), '')
    assert.equal(resolve, undefined)
    foreign.setData('application/x-plangent-mention', '{invalid')
    assert.equal(readMentionDrag(foreign), null)
    dragEvent('drop', foreign); await flushDrop()
    assert.equal(resolve, undefined)
    const valid = transfer()
    writeMentionDrag(valid, { projectId: 'project-a', workspaceId: 'work', path: 'a.ts', dir: false })
    dragEvent('drop', valid)
    chat.props.draftKey = 'drop:second'; await nextTick()
    resolve({ ok: true, json: async () => [{ path: 'a.ts', dir: false, uri: 'file:///work/a.ts' }] })
    await flushDrop()
    assert.equal(chat.value(), '')
    assert.equal(chat.store.get('drop:first').mentions.size, 0)
    assert.equal(chat.store.get('drop:second').mentions.size, 0)
  } finally { global.fetch = previousFetch; chat.unmount() }
})

test('disk files dropped on the composer remain attachments', async () => {
  const chat = await harness({ draftKey: 'drop:attachment' })
  try {
    dragEvent('drop', { types: ['Files'], files: [{ name: 'note.txt', size: 5, type: 'text/plain', text: async () => 'notes' }] })
    await flushDrop(); await chat.submit()
    assert.deepEqual(chat.sent[0], [{ type: 'resource', resource: { uri: 'file:///note.txt', mimeType: 'text/plain', text: 'notes' } }])
  } finally { chat.unmount() }
})
