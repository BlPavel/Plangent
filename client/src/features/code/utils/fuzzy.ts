export interface FuzzyHit { path: string; score: number; positions: number[] }

const SEPARATORS = new Set(['/', '.', '-', '_', ' '])

/**
 * Subsequence match of `query` in `path`. Higher is better: consecutive characters, word starts and
 * matches in the file name (after the last slash) score more; longer paths lose a little.
 */
export function fuzzyScore(path: string, query: string): FuzzyHit | null {
  const text = path.toLowerCase()
  const needle = query.toLowerCase().replace(/\s+/g, '')
  if (!needle) return { path, score: 0, positions: [] }
  const nameStart = path.lastIndexOf('/') + 1
  const positions: number[] = []
  let score = 0
  let from = 0
  let previous = -2
  for (const ch of needle) {
    const at = text.indexOf(ch, from)
    if (at < 0) return null
    positions.push(at)
    score += 1
    if (at === previous + 1) score += 5
    if (at === 0 || SEPARATORS.has(path[at - 1])) score += 4
    else if (path[at] !== path[at].toLowerCase() && path[at - 1] === path[at - 1].toLowerCase()) score += 3
    if (at >= nameStart) score += 2
    previous = at
    from = at + 1
  }
  const name = text.slice(nameStart)
  if (name === needle) score += 40
  else if (name.startsWith(needle)) score += 20
  else if (name.includes(needle)) score += 10
  score -= path.length * 0.05
  return { path, score, positions }
}

/** Files that match, best first; ties keep the original (alphabetical) order. */
export function fuzzyFiles(files: readonly string[], query: string, limit = 50): FuzzyHit[] {
  if (!query.trim()) return files.slice(0, limit).map(path => ({ path, score: 0, positions: [] }))
  const hits: FuzzyHit[] = []
  for (const path of files) {
    const hit = fuzzyScore(path, query)
    if (hit) hits.push(hit)
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
