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
const { createApp, h, reactive, nextTick } = require('vue')
const { createPinia } = require('pinia')
const { build } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')

const compiled = (async () => {
  const entry = path.resolve('client/src/features/agent-chat/components/ChatComposer.vue')
  const bundle = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue', 'pinia'],
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        let contents = compileScript(descriptor, { id: args.path, inlineTemplate: true }).content
        if (args.path === entry) contents += '\nexport { useChatDraftsStore as testDraftsStore }'
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
  const sent = []
  let app
  function mount() {
    app = createApp({ render: () => h(Composer, { ...props, onSend: content => sent.push(content) }) })
    app.use(pinia)
    app.mount('#app')
  }
  mount()
  return {
    props, sent, store: testDraftsStore(pinia),
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

test('deleting a session removes its draft and selection without touching other chats', async () => {
  const chat = await harness({ draftKey: 'new-chat:project-a' })
  try {
    chat.store.get('session:chat-a').text = 'Удаляемый черновик'
    chat.store.get('session:chat-b').text = 'Другой черновик'
    chat.store.selectedByProject['project-a'] = 'chat-a'
    chat.store.selectedByProject['project-b'] = 'chat-b'
    await chat.remount()
    assert.equal(chat.store.selectedByProject['project-a'], 'chat-a')
    chat.store.removeSession('chat-a')
    assert.equal(chat.store.drafts['session:chat-a'], undefined)
    assert.equal(chat.store.selectedByProject['project-a'], undefined)
    assert.equal(chat.store.get('session:chat-b').text, 'Другой черновик')
    assert.equal(chat.store.selectedByProject['project-b'], 'chat-b')
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
