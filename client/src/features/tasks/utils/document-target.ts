import type { AnalysisSection, Material, MaterialType } from '@contracts'

/** Match the server's identifier lines, excluding examples in fenced code. */
function hasIdentifier(content: string, identifier: string): boolean {
  let fence: string | undefined
  for (const line of content.split(/\r?\n/)) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/)
    if (delimiter) {
      if (!fence) fence = delimiter[1]
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = undefined
      continue
    }
    if (!fence && line.match(/^ {0,3}(?:#{1,6}\s+)?\*\*((?:D|Q)[1-9]\d*)\*\*(?=\s|[:.\-—]|$)/)?.[1] === identifier) return true
  }
  return false
}

/** Resolve both legacy analysis links and links to a saved preparation document. */
export function resolveDocumentTarget(target: string, sections: AnalysisSection[], materials: Record<MaterialType, Material | null>) {
  const material = /^(architecture|qa)(?:#([^#/]+))?$/.exec(target)
  if (material) {
    const type = material[1] as MaterialType
    const identifier = material[2]
    const document = materials[type]
    return document && (!identifier || hasIdentifier(document.content, identifier))
      ? { type, identifier } : null
  }
  const [slug, ...names] = target.split('/')
  const section = sections.find(s => s.slug === slug)
  return section && (!names.length || section.files.some(f => f.name === names.join('/')))
    ? { type: 'analysis' as const, section, file: names.length ? names.join('/') : undefined } : null
}
