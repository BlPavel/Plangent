import path from 'node:path'

const root = path.resolve('client/src')
const doc = ' See docs/client/ARCHITECTURE.md.'
export default {
  meta: { type: 'problem', schema: [], messages: { boundary: '{{reason}}' + doc } },
  create(context) {
    const file = context.filename
    const owner = path.relative(root, file).replaceAll('\\', '/').split('/')
    function check(node) {
      const source = node.source?.value
      if (typeof source !== 'string') return
      const target = source.startsWith('.') ? path.resolve(path.dirname(file), source)
        : /^@(core|shared|features)(\/|$)/.test(source) ? path.resolve(root, source.slice(1))
        : source.startsWith('src/') ? path.resolve(root, source.slice(4)) : null
      const parts = target && path.relative(root, target).replaceAll('\\', '/').split('/')
      const contract = /^@contracts(?:\/|$)/.test(source) || target?.replaceAll('\\', '/').includes('/contracts/')
      let reason
      if (parts && ((owner[0] === 'shared' && ['core', 'features', 'app'].includes(parts[0])) ||
        (owner[0] === 'core' && ['features', 'app'].includes(parts[0])) ||
        (owner[0] === 'features' && parts[0] === 'app'))) reason = 'Import violates the client layer direction.'
      if (owner[0] === 'shared' && contract) reason = 'shared must remain independent of contracts.'
      if (target?.replaceAll('\\', '/').includes('/server/')) reason = 'Import server types through @contracts.'
      if (contract && node.importKind !== 'type' && node.exportKind !== 'type' &&
        !(node.specifiers?.length && node.specifiers.every(s => s.importKind === 'type' || s.exportKind === 'type'))) reason = 'Use import type for contracts.'
      if (parts?.[0] === 'features' && (owner[0] !== 'features' || owner[1] !== parts[1]) &&
        parts.length > 2 && !(parts.length === 3 && /^index(?:\.ts)?$/.test(parts[2]))) reason = 'Use the feature index.ts public API.'
      if (parts?.[0] === 'core' && parts[1] === 'api' && owner[0] !== 'core' && path.basename(file) !== 'api.ts' &&
        (parts.length === 2 || /^(index|endpoint)(\.ts)?$/.test(parts[2]))) reason = 'Use transport only inside a feature api.ts.'
      if (reason) context.report({ node, messageId: 'boundary', data: { reason } })
    }
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check,
      ImportExpression(node) { check({ ...node, source: node.source, importKind: 'value' }) } }
  },
}
