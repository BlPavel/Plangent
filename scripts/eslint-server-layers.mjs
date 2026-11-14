import path from 'node:path'

const root = path.resolve('server')
// Imports point down this order. Upward collaboration is composed through callbacks
// in server/core-services.ts; type-only references do not load another module.
const modules = ['shared', 'files', 'integrations', 'settings', 'projects', 'library', 'agents', 'tasks', 'workspaces', 'git', 'preparation', 'execution', 'review', 'work', 'terminals']
export default {
  meta: { type: 'problem', schema: [], messages: { boundary: '{{reason}}' } },
  create(context) {
    const file = context.filename
    const location = path.relative(root, file).replaceAll('\\', '/').split('/')
    const owner = location[0]
    const module = location[1]
    if (owner === 'tests') return {}
    const report = (node, reason) => context.report({ node, messageId: 'boundary', data: { reason } })
    function check(node) {
      const source = node.source?.value
      if (typeof source !== 'string') return
      const target = source.startsWith('.') || path.isAbsolute(source) ? path.resolve(path.dirname(file), source) : null
      const layer = target && path.relative(root, target).replaceAll('\\', '/').split('/')[0]
      const contract = /^@contracts(?:\/|$)/.test(source) || (target && path.relative(path.resolve('contracts'), target).split(path.sep)[0] !== '..')
      const parts = target && path.relative(root, target).replaceAll('\\', '/').replace(/\.(?:ts|js)$/, '').split('/')
      if (owner === 'core') {
        if (source === 'better-sqlite3' || (layer === 'infrastructure' && parts[1] === 'db' &&
            (parts[2] !== 'repositories' || parts[3] !== module))) {
          report(node, 'Core can access persistence only through its own module repositories.')
          return
        }
        if (layer === 'core' && parts[1] !== module) {
          if (parts.length > 2 && !(parts.length === 3 && parts[2] === 'index')) {
            report(node, 'Import another core module through its index.ts public API.')
            return
          }
          const typeOnly = node.importKind === 'type' || node.exportKind === 'type' ||
            (node.specifiers?.length && node.specifiers.every(specifier => specifier.importKind === 'type' || specifier.exportKind === 'type'))
          if (!typeOnly && modules.indexOf(parts[1]) >= modules.indexOf(module)) {
            report(node, `Core dependency ${module} → ${parts[1]} would violate the acyclic module order. Inject callbacks from the composition root.`)
            return
          }
        }
      }
      if ((owner === 'api' && layer === 'infrastructure') ||
          (owner === 'core' && layer === 'api') ||
          (owner === 'infrastructure' && ['core', 'api'].includes(layer)) ||
          (owner === 'models' && !contract)) {
        report(node, `Import ${source} violates server layer direction (${owner} → ${layer || source}).`)
      }
    }
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check,
      ImportExpression: check,
      TSImportType(node) {
        const argument = node.argument ?? node.parameter
        check({ ...node, source: argument?.literal ?? argument, importKind: 'type' })
      },
      TSImportEqualsDeclaration(node) { check({ ...node, source: node.moduleReference?.expression }) },
      Literal(node) {
        if (owner === 'core' && typeof node.value === 'string' && /^\s*(?:SELECT\b[\s\S]*\bFROM\b|INSERT\s+INTO\b|UPDATE\b[\s\S]*\bSET\b|DELETE\s+FROM\b|CREATE\s+TABLE\b)/i.test(node.value)) report(node, 'SQL belongs in the module repository, not core.')
      },
      TemplateElement(node) {
        if (owner === 'core' && /^\s*(?:SELECT\b[\s\S]*\bFROM\b|INSERT\s+INTO\b|UPDATE\b[\s\S]*\bSET\b|DELETE\s+FROM\b|CREATE\s+TABLE\b)/i.test(node.value.raw)) report(node, 'SQL belongs in the module repository, not core.')
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check({ ...node, source: node.arguments[0] })
      } }
  },
}
