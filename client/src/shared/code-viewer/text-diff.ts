export type TextDiffLine = { kind: 'same' | 'add' | 'del'; text: string }
/** A run of unchanged lines folded away between hunks. */
export type TextDiffRow = TextDiffLine | { kind: 'skip'; count: number }

/** Line diff by longest common subsequence; library items are small enough for the quadratic table. */
export function diffLines(before: string, after: string): TextDiffLine[] {
  const a = before ? before.split('\n') : [], b = after ? after.split('\n') : []
  const n = a.length, m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: TextDiffLine[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', text: a[i++] })
    else out.push({ kind: 'add', text: b[j++] })
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'add', text: b[j++] })
  return out
}


export function diffTextHunks(before: string, after: string): import('./diff-model').DiffHunk[] {
  const lines = diffLines(before, after)
  if (!lines.some(line => line.kind !== 'same')) return []
  return [{ oldStart: 1, oldLines: lines.filter(l => l.kind !== 'add').length, newStart: 1, newLines: lines.filter(l => l.kind !== 'del').length, lines: lines.map(l => ({ type: l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ', text: l.text })) }]
}
