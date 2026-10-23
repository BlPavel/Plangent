const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { window } = require('linkedom').parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'ShadowRoot']) global[key] = window[key]
global.location = { protocol: 'http:', host: 'localhost' }
let socket
global.WebSocket = class {
  constructor() { socket = this }
  close() {}
}
const { createApp, h, reactive, nextTick } = require('vue')
const { createPinia } = require('pinia')
const { build } = require('esbuild')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

const compiled = (async () => {
  const bundle = await build({
    entryPoints: [path.resolve('client/src/features/library/components/SkillsManager.vue')],
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue', 'pinia'],
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core'), '@features': path.resolve('client/src/features') },
    plugins: [{ name: 'vue-test', setup(build) {
      // Scope tests exercise the real library component, store, API, and event subscription.
      build.onLoad({ filter: /features[\\/]agents[\\/]index\.ts$/ }, () => ({
        contents: 'export const useAgentsStore = () => ({ agents: [], load: async () => {} })', loader: 'ts',
      }))
      build.onLoad({ filter: /features[\\/]projects[\\/]index\.ts$/ }, () => ({
        contents: 'export const AvailabilityField = { render: () => null }; export const useProjectsStore = () => ({ projects: [], load: async () => {}, byId: () => undefined })', loader: 'ts',
      }))
      build.onLoad({ filter: /\.vue$/ }, args => {
        if (['AppModal.vue', 'LibraryItemForm.vue'].includes(path.basename(args.path))) {
          return { contents: 'export default { render: () => null }', loader: 'ts' }
        }
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        const contents = descriptor.script || descriptor.scriptSetup
          ? compileScript(descriptor, { id: args.path, inlineTemplate: true }).content
          : compileTemplate({ source: descriptor.template.content, filename: args.path, id: args.path }).code + '\nexport default { render }'
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  const mod = new Module(path.resolve('scripts/.library-ui-test.cjs'), module)
  mod.filename = path.resolve('scripts/.library-ui-test.cjs')
  mod.paths = module.paths
  mod._compile(bundle.outputFiles[0].text, mod.filename)
  return mod.exports.default
})()

const item = (id, scope, type = 'skill') => ({
  id, title: id, slug: id, scope, type, enabled: true, agent_filter: [], targets: scope === 'global' ? [] : ['project-a'],
})
const response = data => ({ ok: true, status: 200, json: async () => data })
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await nextTick() }
const titles = selector => [...document.querySelectorAll(`${selector} .item-title`)].map(el => el.textContent)

test('global skills and review skills exclude project items, including simultaneous project refreshes', async () => {
  const Skills = await compiled
  const requests = []
  const projectReplies = []
  global.fetch = async url => {
    const params = new URL(url, 'http://localhost').searchParams
    requests.push(params)
    const type = params.get('type') || 'skill'
    if (params.has('forProject')) return new Promise(resolve => projectReplies.push(() => resolve(response([item('project-skill', 'project')]))))
    return response(params.get('scope') === 'global' ? [item(`global-${type}`, 'global', type)] : [item('wrong-project-skill', 'project')])
  }
  const props = reactive({ allowedTypes: ['skill'] })
  const app = createApp({ render: () => h('div', [
    h('section', { id: 'global' }, h(Skills, { scope: 'global', ...props })),
    h('section', { id: 'project' }, h(Skills, { scope: 'project', projectId: 'project-a' })),
  ]) })
  app.use(createPinia())
  app.mount('#app')
  try {
    await flush()
    assert.deepEqual(titles('#global'), ['global-skill'])
    projectReplies.shift()()
    await flush()
    assert.deepEqual(titles('#project'), ['project-skill'])
    assert.deepEqual(titles('#global'), ['global-skill'], 'a late project response must not replace the settings list')
    socket.onmessage({ data: JSON.stringify({ type: 'library_changed' }) })
    await flush()
    projectReplies.shift()()
    await flush()
    assert.deepEqual(titles('#global'), ['global-skill'])
    props.allowedTypes = ['review-skill']
    await flush()
    assert.deepEqual(titles('#global'), ['global-review-skill'])
    assert.ok(requests.filter(params => !params.has('forProject')).every(params => params.get('scope') === 'global'))
  } finally { app.unmount() }
})

test('outdated skill responses cannot replace the newly selected project', async () => {
  const Skills = await compiled
  const replies = {}
  global.fetch = url => {
    const id = new URL(url, 'http://localhost').searchParams.get('forProject')
    return new Promise(resolve => { replies[id] = () => resolve(response([item(id, 'project')])) })
  }
  const props = reactive({ scope: 'project', projectId: 'project-a' })
  const app = createApp({ render: () => h(Skills, props) })
  app.use(createPinia())
  app.mount('#app')
  try {
    await flush()
    props.projectId = 'project-b'
    await flush()
    replies['project-b']()
    await flush()
    assert.deepEqual(titles('#app'), ['project-b'])
    replies['project-a']()
    await flush()
    assert.deepEqual(titles('#app'), ['project-b'])
  } finally { app.unmount() }
})
