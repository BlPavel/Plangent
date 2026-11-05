const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { window } = require('linkedom').parseHTML('<html><body></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key]
Object.defineProperty(window.HTMLElement.prototype, Symbol.toStringTag, { value: 'HTMLElement' })
window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 54, left: 20, right: 220, width: 200, height: 34 })
window.innerWidth = 640; window.innerHeight = 480
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get: () => 200 })
Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { get: () => 180 })
window.HTMLElement.prototype.focus = function () { document.testActive = this }
Object.defineProperty(document, 'activeElement', { get: () => document.testActive })
global.requestAnimationFrame = fn => setTimeout(fn, 0)
global.cancelAnimationFrame = clearTimeout
const { createApp, h, reactive, nextTick } = require('vue')
const { build } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
const compiled = (async () => {
  const result = await build({
    stdin: { contents: `
      export { default as AppButton } from './client/src/shared/ui/AppButton.vue'
      export { default as AppSelect } from './client/src/shared/ui/AppSelect.vue'
      export { default as AppPopover } from './client/src/shared/ui/AppPopover.vue'
      export { default as AppCombobox } from './client/src/shared/ui/AppCombobox.vue'
      export { default as AppTabs } from './client/src/shared/ui/AppTabs.vue'
      export { default as AppCheckbox } from './client/src/shared/ui/AppCheckbox.vue'
      export { default as FormField } from './client/src/shared/ui/FormField.vue'
      export { diffTextHunks, diffLines } from './client/src/shared/code-viewer/text-diff'
      export { endpoint } from './client/src/core/api/endpoint'
      export { subscribeCodeProject } from './client/src/features/code/events'
      export { onServerEvent } from './client/src/core/api/events'
    `, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue'],
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core') },
    plugins: [{ name: 'vue', setup(build) { build.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
      const contents = descriptor.script || descriptor.scriptSetup
        ? compileScript(descriptor, { id: args.path, inlineTemplate: true }).content
        : compileTemplate({ source: descriptor.template.content, filename: args.path, id: args.path }).code + '\nexport default { render }'
      return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
    }) } }],
  })
  const mod = new Module(path.resolve('scripts/.ui-primitives.cjs'), module)
  mod.filename = mod.id; mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
})()
function mount(Component, initial, listeners = {}, slots) {
  const host = document.createElement('div'); document.body.append(host)
  const props = reactive(initial)
  const app = createApp({ render: () => h(Component, { ...props, ...listeners }, slots) })
  app.mount(host)
  return { host, props, dispose() { app.unmount(); host.remove() } }
}
async function settle() { await nextTick(); await nextTick() }
function key(target, value) { const event = new window.Event('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'key', { value }); target.dispatchEvent(event) }

test('disabled links cannot navigate or invoke actions; enabled links retain href', async () => {
  const { AppButton } = await compiled
  let count = 0
  const view = mount(AppButton, { as: 'a', href: '/target', disabled: true }, { onClick: () => count++ })
  try {
    const anchor = view.host.querySelector('a')
    assert.equal(anchor.getAttribute('href'), null)
    anchor.click(); assert.equal(count, 0)
    view.props.disabled = false; await settle()
    assert.equal(anchor.getAttribute('href'), '/target')
    anchor.click(); assert.equal(count, 1)
  } finally { view.dispose() }
})
test('select teleports options, respects disabled choices and closes after a pick', async () => {
  const { AppSelect } = await compiled
  const picked = []
  const view = mount(AppSelect, { modelValue: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }] }, { 'onUpdate:modelValue': value => picked.push(value) })
  try {
    view.host.querySelector('button').click(); await settle()
    const list = document.querySelector('[role="listbox"]')
    assert.ok(list); assert.equal(view.host.contains(list), false)
    assert.equal(list.querySelectorAll('button')[1].disabled, true)
    list.querySelectorAll('button')[2].click(); await settle()
    assert.deepEqual(picked, ['c']); assert.equal(document.querySelector('[role="listbox"]'), null)
  } finally { view.dispose() }
})
test('Escape dismisses popovers and restores trigger focus', async () => {
  const { AppSelect } = await compiled
  const view = mount(AppSelect, { modelValue: 'a', options: [{ value: 'a', label: 'A' }] })
  try {
    const button = view.host.querySelector('button'); button.click(); await settle()
    key(document.querySelector('[role="option"]'), 'Escape'); await settle()
    assert.equal(document.querySelector('[role="listbox"]'), null)
    assert.equal(document.activeElement, button)
  } finally { view.dispose() }
})
test('tabs skip disabled items during keyboard navigation', async () => {
  const { AppTabs } = await compiled
  const picked = []
  const view = mount(AppTabs, { modelValue: 'a', items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }] }, { 'onUpdate:modelValue': value => picked.push(value) })
  try { key(view.host.querySelector('button'), 'ArrowRight'); assert.deepEqual(picked, ['c']) } finally { view.dispose() }
})
test('a nested popover keeps its parent open while picking an option', async () => {
  const { AppPopover, AppSelect } = await compiled
  const anchor = document.createElement('button'); document.body.append(anchor)
  const dismissed = []
  const view = mount(AppPopover, { modelValue: true, anchor }, { 'onUpdate:modelValue': value => dismissed.push(value) }, {
    default: () => h(AppSelect, { modelValue: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
  })
  try {
    await settle()
    document.querySelector('.popover button').click(); await settle()
    const option = document.querySelector('[role="option"]')
    assert.ok(option)
    option.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    assert.deepEqual(dismissed, [])
  } finally { view.dispose(); anchor.remove() }
})
test('rich tabs select with the keyboard and report terminal actions', async () => {
  const { AppTabs } = await compiled
  const selected = [], closed = [], renamed = []
  const view = mount(AppTabs, { rich: true, modelValue: 'a', items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }, {
    'onUpdate:modelValue': value => selected.push(value),
    'onTabMiddle': value => closed.push(value),
    'onTabDblclick': value => renamed.push(value),
  })
  try {
    const tabs = view.host.querySelectorAll('[role="tab"]')
    key(tabs[0], 'ArrowRight')
    tabs[1].dispatchEvent(new window.Event('dblclick', { bubbles: true }))
    const middle = new window.Event('mousedown', { bubbles: true, cancelable: true }); middle.button = 1
    tabs[1].dispatchEvent(middle)
    assert.deepEqual(selected, ['b'])
    assert.deepEqual(renamed, ['b'])
    assert.deepEqual(closed, ['b'])
  } finally { view.dispose() }
})
test('popover flips above a low trigger and stays within the viewport', async () => {
  const { AppSelect } = await compiled
  const view = mount(AppSelect, { modelValue: 'a', options: [{ value: 'a', label: 'A' }] })
  try {
    view.host.querySelector('.select').getBoundingClientRect = () => ({ top: 440, bottom: 474, left: 620, right: 820, width: 200, height: 34 })
    view.host.querySelector('button').click(); await settle()
    const list = document.querySelector('[role="listbox"]')
    assert.ok(parseFloat(list.style.top) < 440)
    assert.ok(parseFloat(list.style.left) + parseFloat(list.style.width) <= 632)
  } finally { view.dispose() }
})
test('FormField preserves option-slot compatibility without a native select', async () => {
  const { FormField } = await compiled
  const view = mount(FormField, { type: 'select', modelValue: 'b', label: 'Choice' }, {}, { default: () => [h('option', { value: 'a' }, 'Alpha'), h('option', { value: 'b' }, 'Beta')] })
  try {
    assert.equal(view.host.querySelector('select'), null)
    assert.ok(view.host.querySelector('button').textContent.includes('Beta'))
    assert.equal(view.host.querySelector('label').getAttribute('for'), view.host.querySelector('button').id)
  } finally { view.dispose() }
})
test('line diffs reconstruct both inputs, including repeated and empty lines', async () => {
  const { diffLines, diffTextHunks } = await compiled
  for (const [before, after] of [['', 'one'], ['one', ''], ['a\nb\na\n', 'a\na\nb\n'], ['a\n\nb', 'a\nb'], ['same', 'same']]) {
    const lines = diffLines(before, after)
    assert.equal(lines.filter(x => x.kind !== 'add').map(x => x.text).join('\n'), before)
    assert.equal(lines.filter(x => x.kind !== 'del').map(x => x.text).join('\n'), after)
    const hunks = diffTextHunks(before, after)
    assert.equal(hunks.length, before === after ? 0 : 1)
    if (hunks.length) assert.equal(hunks[0].newLines, after ? after.split('\n').length : 0)
  }
})
test('contract transport encodes params, preserves workspace and cancellation, and carries structured errors', async () => {
  const { endpoint } = await compiled
  const calls = [], original = global.fetch
  const controller = new AbortController()
  global.fetch = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ value: 'saved' })) }
  try {
    await endpoint('GET /api/settings/:key')({ params: { key: 'a/b' }, query: { workspace: 'branch one' }, signal: controller.signal })
    assert.equal(calls[0].url, '/api/settings/a%2Fb?workspace=branch+one')
    assert.equal(calls[0].options.signal, controller.signal)
    global.fetch = async () => new Response(JSON.stringify({ error: 'Referenced', confirmation_required: true, references: [{ text: 'step' }] }), { status: 409 })
    await assert.rejects(endpoint('GET /api/settings/:key')({ params: { key: 'x' } }), error => error.status === 409 && error.confirmation_required && error.references[0].text === 'step')
  } finally { global.fetch = original }
})
test('code subscriptions replay after reconnect and unsubscribe only after the last viewer', async () => {
  const { subscribeCodeProject, onServerEvent } = await compiled
  const originalSocket = global.WebSocket, originalLocation = global.location, sockets = []
  global.location = { protocol: 'http:', host: 'localhost' }
  global.WebSocket = class {
    static OPEN = 1
    readyState = 0
    sent = []
    constructor() { sockets.push(this) }
    send(message) { this.sent.push(JSON.parse(message)) }
    close() { this.readyState = 3 }
    connected() { this.readyState = 1; this.onopen() }
  }
  let first, second, keep
  try {
    first = subscribeCodeProject('p', 'w'); second = subscribeCodeProject('p', 'w')
    sockets[0].connected()
    assert.deepEqual(sockets[0].sent, [{ type: 'code:subscribe', projectId: 'p', workspaceId: 'w' }])
    first(); first()
    assert.equal(sockets[0].sent.length, 1)
    sockets[0].onclose()
    keep = onServerEvent(() => {})
    sockets[1].connected()
    assert.equal(sockets[1].sent[0].type, 'code:subscribe')
    second(); second()
    assert.equal(sockets[1].sent.filter(m => m.type === 'code:unsubscribe').length, 1)
  } finally { first?.(); second?.(); keep?.(); global.WebSocket = originalSocket; global.location = originalLocation }
})
