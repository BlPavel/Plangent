export interface FindOptions {
  query: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface TextRange { start: number; end: number }

const MAX_HITS_PER_LINE = 200
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Builds the matcher for the options; null for an empty or invalid pattern (`error` explains why). */
export function findPattern(options: FindOptions): { pattern: RegExp | null; error?: string } {
  if (!options.query) return { pattern: null }
  let source = options.regex ? options.query : escapeRegex(options.query)
  if (options.wholeWord) source = `\\b(?:${source})\\b`
  try { return { pattern: new RegExp(source, options.caseSensitive ? 'g' : 'gi') } }
  catch (cause) { return { pattern: null, error: cause instanceof Error ? cause.message : String(cause) } }
}

/** Matches in one line of text; zero-length matches are skipped. */
export function findInLine(text: string, pattern: RegExp): TextRange[] {
  const result: TextRange[] = []
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) && result.length < MAX_HITS_PER_LINE) {
    if (match[0] === '') { pattern.lastIndex++; continue }
    result.push({ start: match.index, end: match.index + match[0].length })
  }
  return result
}

const ENTITY = /^&(?:amp|lt|gt|quot|#39|#x27);/

/**
 * Wraps text ranges of already highlighted (escaped) HTML in <mark>. Ranges are in plain-text
 * offsets; the mark is closed and reopened around tags so the markup stays well formed.
 * `current` is the index of the range that gets the `cv-hit-current` class.
 */
export function markHtml(html: string, ranges: TextRange[], current = -1): string {
  if (!ranges.length) return html
  let out = ''
  let offset = 0
  let index = 0
  let open = false
  const openMark = () => { out += `<mark class="cv-hit${index === current ? ' cv-hit-current' : ''}">`; open = true }
  const closeMark = () => { out += '</mark>'; open = false }
  let i = 0
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i)
      const tag = html.slice(i, end + 1)
      if (open) { closeMark(); out += tag; openMark() } else out += tag
      i = end + 1
      continue
    }
    let piece = html[i]
    if (html[i] === '&') { const entity = ENTITY.exec(html.slice(i, i + 8)); if (entity) piece = entity[0] }
    const range = ranges[index]
    if (range && !open && offset >= range.start && offset < range.end) openMark()
    out += piece
    offset++
    i += piece.length
    if (open && offset >= ranges[index].end) { closeMark(); index++ }
    // Adjacent ranges: the next one may start right here.
    const next = ranges[index]
    if (next && !open && offset >= next.start && offset < next.end && i < html.length && html[i] !== '<') openMark()
  }
  if (open) closeMark()
  return out
}
