const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const result = buildSync({ stdin: { contents: "export { useDraft } from './client/src/core/composables/useDraft'; export { useDraftsStore } from './client/src/core/stores/drafts'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue', 'pinia'] })
const mod = new Module(__filename + '.bundle', module)
mod.filename = __filename + '.bundle'; mod.paths = module.paths
mod._compile(result.outputFiles[0].text, mod.filename)
module.exports = mod.exports
