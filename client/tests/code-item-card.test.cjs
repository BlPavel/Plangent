const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { parseHTML } = require('linkedom')
const { window } = parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'ShadowRoot']) global[key] = window[key]
Object.defineProperty(window.HTMLElement.prototype, Symbol.toStringTag, { value: 'HTMLElement' })
global.requestAnimationFrame = callback => setTimeout(callback, 0)
global.cancelAnimationFrame = clearTimeout
global.getComputedStyle = () => ({ transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s' })
window.getComputedStyle = global.getComputedStyle
const { createApp, h, reactive, nextTick } = require('vue')
const { createPinia, setActivePinia } = require('pinia')
require('node:test').beforeEach(() => setActivePinia(createPinia()))
window.HTMLElement.prototype.scrollIntoView = () => {}
// Native textarea.value is independent of its child text; emulate that in linkedom.
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', { configurable: true, get() { return this.testValue ?? '' }, set(value) { this.testValue = String(value) } })
window.HTMLTextAreaElement.prototype.setSelectionRange = function(start, end) { this.selectionStart = start; this.selectionEnd = end }
const { build } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

async function component(file, overrides = {}) {
  const bundle = await build({
    entryPoints: [path.resolve(file)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue', 'pinia'],
    loader: { '.css': 'empty', '.md': 'text' },
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core'), '@features': path.resolve('client/src/features') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onLoad({ filter: /\.ts$/ }, args => {
        const contents = overrides[args.path.replace(/\\/g, '/')]
        if (contents !== undefined) return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        let contents = descriptor.script || descriptor.scriptSetup
          ? compileScript(descriptor, { id: args.path, inlineTemplate: true }).content
          : compileTemplate({ source: descriptor.template.content, filename: args.path, id: args.path }).code + '\nexport default { render }'
        if (args.path === path.resolve(file) && file.endsWith('ItemComposer.vue')) contents += '\nexport { useCodeStore as testCodeStore }'
        if (args.path === path.resolve(file) && file.endsWith('ItemView.vue')) contents += '\nexport { provideCodeStores as testProvideCodeStores } from "../stores/context";\nexport { codeReviewsApi as testApi } from "../api";'
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
  const app = createApp({ render: () => h(Card, { ...props, onClose: (value, complete) => { events.push(['close', value]); props.item.closed = true; props.state = 'closed'; complete(true) }, onReply: (text, complete) => { events.push(['reply', text]); complete(true) } }) })
  app.mount('#app')
  try {
    document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
    await nextTick()
    assert.equal(document.querySelectorAll('input[type=radio], [role=radiogroup]').length, 0)
    assert.deepEqual([...document.querySelectorAll('.it-msg.agent ol li')].map(li => li.textContent), ['Use A (рекомендую)', 'Use B'])
    assert.deepEqual([...document.querySelectorAll('.it-body .it-reply > .it-actions button')].map(button => button.textContent.trim()), ['К коду', 'Закрыть', 'Исправить'])
    for (const [status, resolution] of [['answered', 'answered'], ['done', 'accept'], ['needs_decision', 'reject']]) {
      props.item.closed = false
      props.state = 'waiting'
      props.item.status = status
      await nextTick()
      await click('Закрыть')
      assert.deepEqual(events.at(-1), ['close', resolution])
      assert.equal(document.querySelector('.it-body'), null, 'closing an item collapses its discussion')
      assert.equal(document.querySelector('[role="button"][aria-expanded]').getAttribute('aria-expanded'), 'false')
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
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
    assert.equal(document.querySelector('.it-body'), null, 'a queued reply folds the card')
    document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
    await nextTick()
    assert.equal(document.querySelector('textarea').value, '', 'the reply box is empty after queueing')
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
        assert.ok(document.querySelector('[role="listbox"] button'), where)
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
    assert.match(document.querySelector('[aria-label="Контекст и лимиты агента"]').textContent, /25%/)
    document.querySelector('[aria-label="Контекст и лимиты агента"]').click(); await nextTick(); await nextTick()
    assert.match(document.querySelector('.usage-pop').textContent, /250/)
    assert.match(document.querySelector('.usage-pop').textContent, /40%/)
    props.usage = { used: 750, size: 1000 }
    await nextTick()
    assert.match(document.querySelector('[aria-label="Контекст и лимиты агента"]').textContent, /75%/)
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


test('interview menu displays both Plangent and agent commands and preserves their distinct selections', async () => {
  const Menu = await component('client/src/features/agent-chat/components/SuggestMenu.vue')
  const bundle = await build({ entryPoints: [path.resolve('client/src/features/agent-chat/utils/commands.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' })
  const mod = new Module(path.resolve('scripts/.commands-test.cjs'), module)
  mod.filename = path.resolve('scripts/.commands-test.cjs')
  mod._compile(bundle.outputFiles[0].text, mod.filename)
  const { mergeCommands, commandSuggestions } = mod.exports
  const commands = mergeCommands([{ name: 'interview', description: 'Agent interview' }], [{ name: 'interview', description: 'Уточнить решения', source: 'plangent' }])
  const items = commandSuggestions(commands, 'INTER')
  const picks = []
  const app = createApp({ render: () => h(Menu, {
    title: 'Команды', active: 0,
    items, onPick: item => picks.push(item.value),
  }) })
  app.mount('#app')
  try {
    assert.deepEqual([...document.querySelectorAll('.suggest-label')].map(el => el.textContent), ['/interview (plangent)', '/interview'])
    const rows = document.querySelectorAll('[role="listbox"] button')
    rows[0].click(); rows[1].click()
    assert.deepEqual(picks, ['interview', 'agent:interview'])
  } finally { app.unmount() }
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
    const menu = document.querySelector('[role="listbox"]')
    assert.ok(menu.parentElement === document.body, 'overflow on the code viewer cannot clip a teleported menu')
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
    const row = menu.querySelector('button')
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

test('review card keeps every action in one bottom bar that follows the state of the reply', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  const events = []
  const props = reactive({
    item: { id: 'item', status: 'answered', kind: 'question', text: 'Why?', refs: [], file: 'code.ts', scope: 'file', closed: false },
    thread: [{ id: 'a1', item_id: 'item', author: 'agent', kind: 'answer', text: 'Because.', sent: true, options: [], files: [], round_id: null }],
    state: 'waiting', showLocation: false,
  })
  const app = createApp({ render: () => h(Card, {
    ...props, onReply: (text, complete) => { events.push(['reply', text]); complete(true) }, onReplyNow: text => events.push(['reply-now', text]),
    onRemoveMessage: id => events.push(['remove-message', id]), onSendNow: () => events.push(['send-now']),
  }) })
  app.mount('#app')
  const bar = () => [...document.querySelectorAll('.it-reply > .it-actions button')].map(button => button.textContent.trim())
  try {
    document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
    await nextTick()
    assert.deepEqual(bar(), ['Закрыть', 'Исправить'], 'a question that was answered: finish it or turn it into a task')
    const input = document.querySelector('textarea')
    input.value = 'Сделай по первому варианту'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await nextTick()
    assert.deepEqual(bar(), ['Закрыть', 'Исправить', 'Обсудить'], 'once something is written the bar is about that text: close the discussion, make it a task, or queue it')
    // The written reply waits in the queue: the bar now offers to take it back or to send it at once.
    props.thread = [...props.thread, { id: 'q1', item_id: 'item', author: 'developer', kind: 'text', text: 'Сделай по первому варианту', sent: false, options: [], files: [], round_id: null }]
    props.state = 'queued'
    await nextTick()
    assert.equal(document.querySelector('textarea'), null, 'no second reply box while one reply waits')
    assert.deepEqual(bar(), ['Закрыть', 'Отменить'], 'a queued reply can only be taken back; sending is the review\'s «Отправить»')
    assert.equal(buttons().includes('убрать'), false, 'cancelling is not spread over the card')
    await click('Отменить')
    assert.deepEqual(events.at(-1), ['remove-message', 'q1'])
    props.thread = props.thread.filter(message => message.id !== 'q1')
    props.state = 'waiting'
    await nextTick()
    assert.equal(document.querySelector('textarea').value, 'Сделай по первому варианту', 'the cancelled text returns to the box')
    assert.deepEqual(bar(), ['Закрыть', 'Исправить', 'Обсудить'])
    await click('Исправить')
    assert.deepEqual(events.at(-1), ['reply', 'Исправь: Сделай по первому варианту'], 'a question with text becomes a task with that text')
    assert.equal(buttons().includes('Отправить сейчас'), false, 'no second way to send from the card')
  } finally { app.unmount() }
})

test('closing a review item with a written reply uses its existing resolution without sending the draft', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  for (const [status, resolution] of [['answered', 'answered'], ['done', 'accept'], ['needs_decision', 'reject']]) {
    const events = []
    const props = reactive({
      item: { id: `close-typing-${status}`, review_id: 'review', status, kind: 'remark', text: 'Review this', refs: [], file: 'code.ts', scope: 'file', closed: false },
      thread: [], state: 'waiting', busy: false,
    })
    const app = createApp({ render: () => h(Card, {
      ...props,
      onClose: (value, complete) => { events.push(['close', value]); props.item.closed = true; props.state = 'closed'; complete(true) },
      onReply: value => events.push(['reply', value]),
    }) })
    app.mount('#app')
    try {
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      const input = document.querySelector('textarea')
      input.value = 'Unsent reply'
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      await nextTick()
      props.busy = true
      await nextTick()
      assert.equal([...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Закрыть').disabled, true)
      props.busy = false
      await nextTick()
      await click('Закрыть')
      assert.deepEqual(events, [['close', resolution]])
      assert.equal(document.querySelector('.it-body'), null, 'closing folds the discussion')
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      assert.equal(buttons().includes('Закрыть'), false, 'a closed item cannot be closed twice')
      assert.equal(document.querySelector('textarea').value, 'Unsent reply', 'closing preserves the unsent draft')
    } finally { app.unmount() }
  }
})
test('close is available on every open editable review item, including queued replies and active permissions', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  for (const [state, status] of [['queued', 'answered'], ['agent', 'sent'], ['waiting', 'done']]) {
    const events = []
    const props = reactive({
      item: { id: `always-close-${state}`, review_id: 'review', status, kind: 'fix', text: 'Fix it', refs: [], closed: false },
      state, thread: state === 'queued' ? [{ id: 'queued', author: 'developer', text: 'Reply', kind: 'text', sent: false, files: [], options: [] }] : [],
      working: state === 'agent', permissions: state === 'agent' ? [{ permissionId: 'p', toolCall: { title: 'Run command' }, options: [] }] : [],
      readOnly: false,
    })
    const app = createApp({ render: () => h(Card, { ...props, onClose: (value, complete) => { events.push(value); props.item.closed = true; props.state = 'closed'; complete(true) } }) })
    app.mount('#app')
    try {
      if (!document.querySelector('.it-body')) {
        document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
        await nextTick()
      }
      assert.ok(buttons().includes('Закрыть'), state)
      await click('Закрыть')
      assert.deepEqual(events, [status === 'done' ? 'accept' : 'answered'], state)
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      assert.equal(buttons().includes('Отменить'), false, 'closed queued replies are history')
      assert.ok(document.querySelector('textarea'), 'a closed discussion can receive a new reply')
      props.readOnly = true
      await nextTick()
      assert.equal(buttons().includes('Закрыть'), false, 'history remains read-only')
    } finally { app.unmount() }
  }
})
test('actions preserve drafts until the server confirms success', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  for (const action of ['Обсудить', 'В очередь', 'Исправить', 'Закрыть']) {
    let complete
    const props = reactive({
      draftKey: `failure:${action}`,
      item: { id: action, review_id: 'review', status: 'answered', kind: action === 'В очередь' ? 'fix' : 'question', text: 'Review', refs: [], closed: false },
      thread: [], state: 'waiting', error: '',
    })
    const app = createApp({ render: () => h(Card, { ...props, onReply: (_text, done) => { complete = done }, onClose: (_resolution, done) => { complete = done } }) })
    app.mount('#app')
    try {
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      const input = document.querySelector('textarea')
      input.value = 'Keep my draft'
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      await nextTick()
      const send = async () => {
        if (action === 'Обсудить' || action === 'В очередь') document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        else await click(action)
        await nextTick()
      }
      await send()
      assert.equal(typeof complete, 'function')
      assert.equal(document.querySelector('textarea').value, 'Keep my draft')
      assert.ok(document.querySelector('.it-body'))
      props.error = 'Server refused action'
      complete(false)
      await nextTick()
      assert.equal(document.querySelector('[role=alert]').textContent, 'Server refused action')
      assert.equal(document.querySelector('textarea').value, 'Keep my draft')
      await send()
      complete(true)
      await nextTick()
      assert.equal(document.querySelector('.it-body'), null)
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      assert.equal(document.querySelector('textarea').value, action === 'Закрыть' ? 'Keep my draft' : '')
    } finally { app.unmount() }
  }
})

test('inline and panel actions use the provided workspace and preserve failed HTTP replies across remounts', async () => {
  const View = await component('client/src/features/code/components/ItemView.vue', {
    [path.resolve('client/src/features/code/stores/review-agent.ts').replace(/\\/g, '/')]: 'export const useReviewAgentStore = () => ({ busy: false, focusItem: null, permissions: [] })',
    [path.resolve('client/src/core/stores/app.ts').replace(/\\/g, '/')]: 'export const useAppStore = () => ({ toast() {} })',
  })
  const originalFetch = global.fetch
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
  try {
    for (const kind of ['question', 'fix', 'implement']) {
      const item = reactive({ id: `http-${kind}`, review_id: 'review', kind: kind === 'implement' ? 'question' : kind, author: 'developer', status: 'answered', text: 'Review', refs: [], closed: false, file: 'code.ts', scope: 'file' })
      const store = reactive({
        messages: [],
        async addMessage(review, id, body) {
          const message = await View.testApi.addMessage('provided-project', review, id, body, 'provided-workspace')
          store.messages.push(message)
          if (body.kind === 'implement') item.kind = 'fix'
        },
        async closeItem(review, id, resolution) {
          Object.assign(item, await View.testApi.closeItem('provided-project', review, id, resolution, 'provided-workspace'))
        },
      })
      let response
      const requests = []
      global.fetch = (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) })
        return new Promise(resolve => { response = (status, body) => resolve(new Response(JSON.stringify(body), { status })) })
      }
      const mount = () => {
        const app = createApp({ setup() {
          View.testProvideCodeStores(store, {})
          return () => h(View, { item, showLocation: kind === 'question', embedded: kind === 'fix' })
        } })
        app.mount('#app')
        return app
      }
      let app = mount()
      try {
        document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
        await nextTick()
        const input = document.querySelector('textarea')
        input.value = 'Persist this reply'
        input.dispatchEvent(new window.Event('input', { bubbles: true }))
        await nextTick()
        await click('Закрыть')
        response(409, { error: 'Close rejected' })
        await settle()
        assert.equal(document.querySelector('[role=alert]').textContent, 'Close rejected')
        if (kind === 'implement') await click('Исправить')
        else document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        response(500, { error: 'Reply rejected' })
        await settle()
        assert.equal(document.querySelector('[role=alert]').textContent, 'Reply rejected')
        assert.equal(document.querySelector('textarea').value, 'Persist this reply')
        app.unmount()
        app = mount()
        document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
        await nextTick()
        assert.equal(document.querySelector('textarea').value, 'Persist this reply')
        if (kind === 'implement') await click('Исправить')
        else document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        response(201, { id: 'saved', item_id: item.id, author: 'developer', kind: 'text', text: 'Persist this reply', files: [], options: [], sent: false })
        await settle()
        assert.equal(document.querySelector('.it-body'), null)
        document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
        await nextTick()
        assert.ok([...document.querySelectorAll('.it-msg.developer')].some(message => message.textContent.includes('Persist this reply')))
        if (kind === 'implement') assert.equal(buttons().includes('Исправить'), false, 'a converted question uses fix actions')
        await click('Закрыть')
        response(200, { closed: true })
        await settle()
        assert.equal(item.closed, true)
        assert.equal(document.querySelector('.it-body'), null)
        assert.deepEqual(requests.map(request => request.url), ['close', 'messages', 'messages', 'close'].map(action => `/api/projects/provided-project/code-reviews/review/items/${item.id}/${action}?workspace=provided-workspace`))
        assert.deepEqual(requests[1].body, { kind: kind === 'implement' ? 'implement' : 'text', text: kind === 'implement' ? 'Исправь: Persist this reply' : 'Persist this reply' })
        assert.equal(item.kind, kind === 'implement' ? 'fix' : kind)
      } finally { app.unmount() }
    }
  } finally { global.fetch = originalFetch }
})
test('review cards retain changed file names without a view-change action', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  for (const embedded of [false, true]) {
    const app = createApp({ render: () => h(Card, {
      item: { id: `no-diff-${embedded}`, status: 'done', kind: 'fix', text: 'Fixed', refs: [], closed: false },
      thread: [{ id: 'change', author: 'agent', kind: 'change', text: 'Changed', files: ['code.ts'], options: [], round_id: 'round', sent: true }],
      state: 'waiting', embedded,
    }) })
    app.mount('#app')
    try {
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      assert.equal(buttons().includes('Посмотреть правку'), false)
      assert.equal(document.querySelector('.it-file').textContent, 'code.ts')
    } finally { app.unmount() }
  }
})
test('draft actions put delete to the left of edit, with no close action', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  const app = createApp({ render: () => h(Card, {
    item: { id: 'draft-actions', status: 'draft', kind: 'fix', text: 'Draft', refs: [], closed: false, file: 'code.ts' },
    thread: [], state: 'draft', showLocation: true,
  }) })
  app.mount('#app')
  try {
    document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
    await nextTick()
    assert.deepEqual([...document.querySelectorAll('.it-actions button')].map(button => button.textContent.trim()), ['К коду', 'Удалить', 'Править'])
  } finally { app.unmount() }
})
test('accepted cards return to waiting for a developer decision and keep their discussion open', async () => {
  const Card = await component('client/src/features/code/components/ItemCard.vue')
  for (const embedded of [false, true]) {
    let complete
    const props = reactive({
      item: { id: `return-${embedded}`, review_id: 'review', status: 'done', kind: 'fix', text: 'Fixed', refs: [], closed: true },
      thread: [], state: 'closed', embedded, readOnly: false,
    })
    const app = createApp({ render: () => h(Card, { ...props, onClose: (resolution, done) => { assert.equal(resolution, 'reopen'); complete = done } }) })
    app.mount('#app')
    try {
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      await click('Вернуть в доработку')
      complete(false)
      await nextTick()
      assert.ok(buttons().includes('Вернуть в доработку'), 'a failed return keeps the card accepted')
      await click('Вернуть в доработку')
      props.item.closed = false
      props.state = 'waiting'
      complete(true)
      await nextTick()
      assert.ok(document.querySelector('.it-body'), 'the returned card stays expanded')
      assert.ok(buttons().includes('Закрыть'))
      assert.equal(buttons().includes('Вернуть в доработку'), false)
      assert.ok(document.querySelector('.it-status').textContent.includes('Проверьте правку'))
      props.item.closed = true
      props.state = 'closed'
      props.readOnly = true
      await nextTick()
      document.querySelector('[role="button"][aria-expanded]').dispatchEvent(new window.Event('click', { bubbles: true }))
      await nextTick()
      assert.equal(buttons().includes('Вернуть в доработку'), false, 'history remains read-only')
    } finally { app.unmount() }
  }
})