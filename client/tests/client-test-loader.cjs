const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

// Resolve the same aliases and relative modules as the client, preserving explicit mocks.
exports.loader = function loader(mocks = {}, globals = {}, inlineTemplate = true) {
  const cache = new Map()
  function resolve(name, from) {
    if (['@features/tasks', '@features/projects'].includes(name)) name += '/api'
    let file = name.startsWith('.') ? path.resolve(path.dirname(from), name)
      : /^@(core|shared|features)\//.test(name) ? path.resolve('client/src', name.slice(1)) : null
    if (!file) return null
    return [file, file + '.ts', path.join(file, 'index.ts')].find(p => fs.existsSync(p) && fs.statSync(p).isFile())
  }
  function load(file, sourceOverride) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    let source = sourceOverride ?? fs.readFileSync(file, 'utf8')
    if (file.endsWith('.vue') && sourceOverride === undefined) {
      const { descriptor } = parse(source, { filename: file })
      source = descriptor.script || descriptor.scriptSetup ? compileScript(descriptor, { id: file, inlineTemplate }).content
        : compileTemplate({ source: descriptor.template.content, filename: file, id: file }).code + '\nexport default { render }'
    }
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, { exports, require(name) {
      if (name in mocks) return mocks[name]
      if (name.endsWith('.css')) return {}
      if (name.endsWith('?raw')) return { default: fs.readFileSync(path.resolve(path.dirname(file), name.slice(0, -4)), 'utf8') }
      const target = resolve(name, file)
      if (target) for (const [key, mock] of Object.entries(mocks)) if (resolve(key, file) === target) return mock
      return target ? load(target) : require(name)
    }, AbortController, TextDecoder, URLSearchParams, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, document: global.document, window: global.window, ...globals }, { filename: file })
    return exports
  }
  return load
}
