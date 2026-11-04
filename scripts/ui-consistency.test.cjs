const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('@vue/compiler-sfc')
const postcss = require('postcss')
const { ESLint } = require('eslint')

const components = new Set([...fs.readFileSync('client/src/shared/ui/index.ts', 'utf8').matchAll(/default as (\w+)/g)].map(m => m[1]))
const layout = /^(?:margin(?:-.+)?|flex(?:-.+)?|align-self|order|grid(?:-.+)?|(?:min-|max-)?(?:width|height)|position|top|right|bottom|left|inset)$/
// These modules render third-party/editor content, not shared UI internals.
const contentDeep = /^(?:\.xterm(?:-viewport|-screen)?|\.code-view|\.material-hl|mark|svg|h[1-6]|p|ul|ol|table|th|td|pre|code|\.rc|\.chat|\.row(?:[\s.:#>].*)?|\.row-(?:icon|name|menu)(?:[\s.:#>].*)?|\.meter-text|\.branches)$/
function inspect(source, file) {
  const errors = []
  const { descriptor } = parse(source, { filename: file })
  const classes = new Set()
  const names = new Set(components)
  for (const script of [descriptor.script?.content, descriptor.scriptSetup?.content]) {
    for (const match of (script || '').matchAll(/import\s+(\w+)\s+from\s+['"]@shared\/ui\//g)) names.add(match[1])
  }
  function visit(node) {
    const shared = names.has(node.tag)
    for (const prop of node.props || []) {
      const name = prop.type === 6 ? prop.name : prop.arg?.content
      const value = prop.type === 6 ? prop.value?.content || '' : prop.exp?.content || ''
      if (shared && name === 'class') {
        const text = prop.type === 6 ? value : [...value.matchAll(/['"]([^'"]+)['"]|\b([\w-]+)\s*:/g)].map(m => m[1] || m[2]).join(' ')
        for (const cls of text.split(/\s+/)) if (cls) classes.add(cls)
      }
      if (name === 'style') {
        if (shared) errors.push('Move shared component inline styles to layout classes or props (docs/client/ui-components.md)')
        if (/(?:font-size|fontSize|font-family|fontFamily)\s*[:'"\]]+\s*['"]?(?!var\(|inherit)(?:\d|monospace|sans-serif)/.test(value)) errors.push('Use font tokens in inline styles (docs/client/ui-tokens.md)')
      }
    }
    for (const child of node.children || []) visit(child)
  }
  if (descriptor.template?.ast) visit(descriptor.template.ast)
  for (const style of descriptor.styles) {
    const css = postcss.parse(style.content, { from: file })
    css.walkDecls(decl => {
      if (/^(font-size|font-family)$/.test(decl.prop) && !/^(?:var\(--[\w-]+\)|inherit)$/.test(decl.value)) errors.push(`${decl.prop}: ${decl.value}; use tokens (docs/client/ui-tokens.md)`)
      if (decl.prop === 'font' && /\d(?:px|rem|em)\b/.test(decl.value)) errors.push('Use font tokens in shorthand (docs/client/ui-tokens.md)')
    })
    css.walkRules(rule => {
      for (const deep of rule.selector.matchAll(/:deep\(([^)]+)\)/g)) {
        const contentModule = /shared[\\/](?:markdown|code-viewer)[\\/]/.test(file)
        if (!contentModule && !contentDeep.test(deep[1].trim()) && deep[1].trim() !== 'ul ul') errors.push(`Shared UI override ${deep[0]} (docs/client/ui-components.md)`)
      }
      for (const selector of rule.selector.split(',')) {
        // Only the rightmost subject is styled; ancestors may arrange ordinary child content.
        const subject = selector.trim().split(/\s+|>/).at(-1)
        const shared = [...subject.matchAll(/\.([\w-]+)/g)].some(m => classes.has(m[1])) || [...names].some(name => subject === name)
        if (shared) rule.walkDecls(decl => {
          if (!layout.test(decl.prop)) errors.push(`${selector}: ${decl.prop} overrides shared UI (docs/client/ui-components.md)`)
        })
      }
    })
  }
  return errors
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}
test('client uses UI tokens and shared component APIs', () => {
  const errors = files('client/src').filter(file => file.endsWith('.vue') && !file.replaceAll('\\', '/').includes('/shared/ui/'))
    .flatMap(file => inspect(fs.readFileSync(file, 'utf8'), file).map(error => `${file}: ${error}`))
  assert.deepEqual(errors, [])
})
test('UI guard rejects literal fonts and shared UI overrides', () => {
  for (const css of ['.x { font-size: 13px }', '.x { font-family: monospace }', '.x :deep(.select) { color: red }', '.x { color: red }']) {
    assert.ok(inspect(`<template><AppButton class="x" /></template><style>${css}</style>`, 'fixture.vue').length, css)
  }
  assert.deepEqual(inspect('<template><AppButton class="x" /></template><style>.x { margin: 2px; flex: 1 }</style>', 'fixture.vue'), [])
  assert.ok(inspect("<template><AppButton :class=\"{ active: selected }\" /></template><style>.active { color: red }</style>", 'fixture.vue').length)
  assert.ok(inspect("<script setup>import Button from '@shared/ui/AppButton.vue'</script><template><Button class='x' /></template><style>.x { padding: 10px }</style>", 'fixture.vue').length)
  assert.ok(inspect('<template><div style="font-size: 13px" /></template>', 'fixture.vue').length)
})
test('ESLint rejects forbidden layer imports and raw UI', async () => {
  const eslint = new ESLint()
  for (const [filePath, source] of [
    ['shared/probe.ts', "import '@core/api'"],
    ['shared/probe.ts', "import type { Task } from '@contracts'"],
    ['shared/probe.ts', "import '../core/api'"],
    ['core/probe.ts', "import('../features/tasks')"],
    ['shared/probe.ts', "export type { Task } from '@contracts'"],
    ['core/probe.ts', "import '@features/tasks'"],
    ['features/code/probe.ts', "import '../../app/router'"],
    ['features/code/probe.ts', "import { Task } from '@contracts'"],
    ['features/code/probe.ts', "import '../../../../server/models'"],
    ['features/code/probe.ts', "import '@features/tasks/api'"],
    ['features/code/probe.ts', "export * from '../tasks/api'"],
    ['features/code/probe.ts', "import { api as transport } from '@core/api'"],
    ['features/code/Probe.vue', '<template><button class="btn">Save</button></template>'],
  ]) {
    const [result] = await eslint.lintText(source, { filePath: `client/src/${filePath}` })
    assert.ok(result.messages.some(m => m.ruleId === 'local/layers' || m.ruleId?.startsWith('vue/no-restricted')), `${filePath}: ${source}`)
  }
  for (const [filePath, source] of [
    ['shared/probe.ts', "import { ref } from 'vue'"],
    ['features/code/probe.ts', "import type { Task } from '@contracts'"],
    ['features/code/probe.ts', "import { type Task } from '@contracts'"],
    ['features/code/probe.ts', "import '@features/tasks'"],
    ['features/code/probe.ts', "import '@features/code/stores/code'"],
    ['features/code/api.ts', "import { api } from '@core/api'"],
    ['features/code/events.ts', "import { onServerEvent } from '@core/api/events'"],
  ]) {
    const [result] = await eslint.lintText(source, { filePath: `client/src/${filePath}` })
    assert.ok(!result.messages.some(m => m.ruleId === 'local/layers'), `${filePath}: ${source}`)
  }
})
