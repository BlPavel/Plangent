const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { parseHTML } = require('linkedom')
const { window } = parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'ShadowRoot']) global[key] = window[key]
global.requestAnimationFrame = callback => setTimeout(callback, 0)
global.cancelAnimationFrame = clearTimeout
global.getComputedStyle = () => ({ transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s' })
window.getComputedStyle = global.getComputedStyle
const { createApp, h, reactive, nextTick } = require('vue')
const { createPinia, setActivePinia } = require('pinia')
window.HTMLElement.prototype.scrollIntoView = () => {}
// Native textarea.value is independent of its child text; emulate that in linkedom.
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', { configurable: true, get() { return this.testValue ?? '' }, set(value) { this.testValue = String(value) } })
window.HTMLTextAreaElement.prototype.setSelectionRange = function(start, end) { this.selectionStart = start; this.selectionEnd = end }
const { build } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

async function component(file) {
  const bundle = await build({
    entryPoints: [path.resolve(file)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue', 'pinia'],
    loader: { '.css': 'empty', '.md': 'text' },
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core'), '@features': path.resolve('client/src/features') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        let contents = descriptor.script || descriptor.scriptSetup
          ? compileScript(descriptor, { id: args.path, inlineTemplate: true }).content
          : compileTemplate({ source: descriptor.template.content, filename: args.path, id: args.path }).code + '\nexport default { render }'
        if (args.path === path.resolve(file) && file.endsWith('ItemComposer.vue')) contents += '\nexport { useCodeStore as testCodeStore }'
        if (args.path === path.resolve(file) && file.endsWith('UsageMeter.vue')) contents += '\nexport { useChatStore as testChatStore }'
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  const mod = new Module(path.resolve('scripts/.code-item-test.cjs'), module)
  mod.filename = path.resolve('scripts/.code-item-test.cjs'); mod.paths = module.paths
  mod._compile(bundle.outputFiles[0].text, mod.filename)
  return Object.assign(mod.exports.default, mod.exports)
}
const buttons = () => [...document.querySelectorAll('button')].map(button => button.textContent.trim())
async function click(text) {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)
  assert.ok(button, text)
  button.dispatchEvent(new window.Event('click', { bubbles: true }))
  await nextTick()
}

test('review card shows textual suggestions, closes all reply kinds and submits discussion in the developer own words', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  const events = []
  const props = reactive({
    item: { id: 'item', status: 'answered', kind: 'question', text: 'What should we do?', refs: [], file: 'code.ts', scope: 'file', closed: false },
    thread: [{ id: 'reply', author: 'agent', kind: 'options', text: 'Possible approaches:', sent: true,
      options: [{ label: 'Use A', recommended: true }, { label: 'Use B' }], files: [], round_id: null }],
    state: 'waiting', showLocation: true,
  })
  const app = createApp({ render: () => h(Card, { ...props, onClose: value => { events.push(['close', value]); props.item.closed = true; props.state = 'closed' }, onReply: (...args) => events.push(['reply', ...args]) }) })
  app.mount('#app')
  try {
    document.querySelector('.it-line').dispatchEvent(new window.Event('click', { bubbles: true }))
    await nextTick()
    assert.equal(document.querySelectorAll('input[type=radio], [role=radiogroup]').length, 0)
    assert.deepEqual([...document.querySelectorAll('.it-msg.agent ol li')].map(li => li.textContent), ['Use A (рекомендую)', 'Use B'])
    assert.deepEqual([...document.querySelectorAll('.it-body > .it-actions button')].map(button => button.textContent.trim()), ['Закрыть', 'К коду'])
    for (const [status, resolution] of [['answered', 'answered'], ['done', 'accept'], ['needs_decision', 'reject']]) {
      props.item.closed = false
      props.state = 'waiting'
      props.item.status = status
      await nextTick()
      await click('Закрыть')
      assert.deepEqual(events.at(-1), ['close', resolution])
      assert.equal(document.querySelector('.it-body'), null, 'closing an item collapses its discussion')
      assert.equal(document.querySelector('.it-line').getAttribute('aria-expanded'), 'false')
      document.querySelector('.it-line').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      assert.ok(document.querySelector('.it-body'), 'the closed discussion can be expanded again')
      assert.equal(buttons().includes('Закрыть'), false)
    }
    const input = document.querySelector('textarea')
    input.value = 'Давай обсудим второй вариант'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await nextTick()
    document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    assert.deepEqual(events.at(-1), ['reply', 'Давай обсудим второй вариант'])
    assert.equal(input.value, '')
    props.item.closed = true
    props.state = 'closed'
    await nextTick()
    assert.equal(buttons().includes('Закрыть'), false)
    assert.equal(buttons().includes('Открыть снова'), false)
    assert.ok(document.querySelector('textarea'), 'discussion remains available on a closed item')
    props.readOnly = true
    await nextTick()
    assert.equal(document.querySelector('textarea'), null)
    assert.equal(buttons().includes('Закрыть'), false)
    assert.equal(document.querySelectorAll('input[type=radio]').length, 0)
  } finally { app.unmount() }
})


test('file and line review composers use chat mentions and preserve references when editing', async () => {
  const Composer = await component('client/src/features/code/components/ItemComposer.vue')
  const originalFetch = global.fetch
  const queries = []
  global.fetch = async url => {
    queries.push(url)
    return new Response(JSON.stringify([{ path: 'src/other.ts', dir: false, uri: 'file:///repo/src/other.ts' }]), { status: 200 })
  }
  try {
    for (const where of ['code.ts', 'code.ts:3', 'Общее замечание']) {
      const pinia = createPinia(); setActivePinia(pinia)
      const store = Composer.testCodeStore()
      store.projectId = 'p'; store.files = ['code.ts', 'src/other.ts']
      const saved = []
      const app = createApp(Composer, { where, general: where === 'Общее замечание', onSave: value => saved.push(value) }).use(pinia)
      app.mount('#app')
      try {
        const input = document.querySelector('textarea')
        input.value = 'Check @other'; input.setSelectionRange(input.value.length, input.value.length)
        input.dispatchEvent(new window.Event('input', { bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 100)); await nextTick()
        assert.ok(document.querySelector('.suggest-item'), where)
        const key = new window.Event('keydown', { bubbles: true, cancelable: true }); key.key = 'Enter'
        input.dispatchEvent(key); await nextTick(); await nextTick()
        assert.equal(input.value, 'Check @src/other.ts ')
        document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        assert.deepEqual(saved[0].refs, ['src/other.ts'])
      } finally { app.unmount() }
    }
    assert.ok(queries.every(url => url.startsWith('/api/projects/p/mentions?')))
    const pinia = createPinia(); setActivePinia(pinia)
    Composer.testCodeStore().projectId = 'p'
    const saved = []
    const app = createApp(Composer, { where: 'code.ts:3', initialText: 'See @docs/guide.md', initialRefs: ['docs/guide.md'], onSave: value => saved.push(value) }).use(pinia)
    app.mount('#app')
    document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    assert.deepEqual(saved[0].refs, ['docs/guide.md'])
    app.unmount()
  } finally { global.fetch = originalFetch }
})

test('shared usage meter shows session context and account limits with details below the review header', async () => {
  const Meter = await component('client/src/features/agent-chat/components/UsageMeter.vue')
  const pinia = createPinia(); setActivePinia(pinia)
  const chats = Meter.testChatStore()
  chats.limits.agent = { windows: [{ id: 'five-hour', label: '5 часов', percent: 40, resetsAt: null }] }
  const props = reactive({ agentId: 'agent', usage: { used: 250, size: 1000 }, placement: 'below' })
  const app = createApp({ render: () => h(Meter, props) }).use(pinia)
  app.mount('#app')
  try {
    assert.ok(document.querySelector('.usage-below'))
    assert.match(document.querySelector('.usage').textContent, /25%/)
    await click(document.querySelector('.usage-trigger').textContent.trim())
    assert.match(document.querySelector('.usage-pop').textContent, /250/)
    assert.match(document.querySelector('.usage-pop').textContent, /40%/)
    props.usage = { used: 750, size: 1000 }
    await nextTick()
    assert.match(document.querySelector('.usage-trigger').textContent, /75%/)
  } finally { app.unmount() }
})


test('chat composer still sends resource links after moving mention search into shared code', async () => {
  const Composer = await component('client/src/features/agent-chat/components/ChatComposer.vue')
  const originalFetch = global.fetch
  global.fetch = async () => new Response(JSON.stringify([{ path: 'src/code.ts', dir: false, uri: 'file:///repo/src/code.ts' }]), { status: 200 })
  const sent = []
  const app = createApp(Composer, { projectId: 'p', onSend: content => sent.push(content) })
  app.mount('#app')
  try {
    const input = document.querySelector('textarea')
    input.value = 'Look at @code'; input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 100)); await nextTick()
    const pick = new window.Event('keydown', { bubbles: true, cancelable: true }); pick.key = 'Tab'
    input.dispatchEvent(pick); await nextTick(); await nextTick()
    assert.equal(input.value, 'Look at @src/code.ts ')
    document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    assert.deepEqual(sent[0], [{ type: 'text', text: 'Look at @src/code.ts' }, { type: 'resource_link', uri: 'file:///repo/src/code.ts', name: 'src/code.ts' }])
  } finally { app.unmount(); global.fetch = originalFetch }
})


test('mention menu escapes clipping containers, fits the window and follows the input on scroll and resize', async () => {
  const Menu = await component('client/src/features/agent-chat/components/SuggestMenu.vue')
  const oldWidth = window.innerWidth, oldHeight = window.innerHeight
  window.innerWidth = 1024; window.innerHeight = 768
  const clipped = document.createElement('div')
  clipped.style.overflow = 'hidden'
  const anchor = document.createElement('textarea')
  clipped.appendChild(anchor); document.body.appendChild(clipped)
  let rect = { left: 820, top: 40, bottom: 120, width: 260 }
  anchor.getBoundingClientRect = () => rect
  const state = reactive({ visible: true })
  const picks = []
  const app = createApp({ render: () => state.visible ? h(Menu, {
    anchor, title: 'Файлы и папки', items: [{ value: 'file.ts', label: 'file.ts' }], active: 0,
    onDismiss: () => { state.visible = false }, onPick: item => picks.push(item.value),
  }) : null })
  app.mount('#app')
  try {
    await nextTick()
    const menu = document.querySelector('.suggest')
    assert.equal(menu.parentElement, document.body, 'overflow on the code viewer cannot clip a teleported menu')
    assert.equal(menu.style.position, 'fixed')
    assert.equal(menu.style.top, '126px', 'an input near the top opens downward')
    assert.equal(menu.style.left, '756px')
    assert.equal(menu.style.width, '260px')
    assert.ok(menu.querySelector('.suggest-head'))
    rect = { ...rect, top: 620, bottom: 700 }
    window.dispatchEvent(new window.Event('scroll'))
    await nextTick()
    assert.equal(menu.style.top, 'auto')
    assert.equal(menu.style.bottom, '154px', 'an input near the bottom opens upward')
    window.innerWidth = 320; window.innerHeight = 400
    rect = { left: 40, top: 50, bottom: 120, width: 720 }
    window.dispatchEvent(new window.Event('resize'))
    await nextTick()
    assert.equal(menu.style.left, '8px')
    assert.equal(menu.style.width, '304px')
    assert.equal(menu.style.maxHeight, '266px', 'the full popup stays in the available window space')
    const row = menu.querySelector('.suggest-item')
    row.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    row.dispatchEvent(new window.Event('click', { bubbles: true }))
    await nextTick()
    assert.deepEqual(picks, ['file.ts'])
    assert.ok(document.querySelector('.suggest'), 'clicks inside the popup do not dismiss it first')
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    await nextTick()
    assert.equal(document.querySelector('.suggest'), null, 'clicking outside dismisses the popup')
  } finally { app.unmount(); clipped.remove(); window.innerWidth = oldWidth; window.innerHeight = oldHeight }
})
