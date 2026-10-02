export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }
/** A run of unchanged lines folded away between hunks. */
export type DiffRow = DiffLine | { kind: 'skip'; count: number }

/** Line diff by longest common subsequence; library items are small enough for the quadratic table. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [], b = after ? after.split('\n') : []
  const n = a.length, m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffLine[] = []
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

/** Keeps `context` unchanged lines around each change and folds the rest. */
export function foldDiff(lines: DiffLine[], context = 3): DiffRow[] {
  const keep = lines.map(() => false)
  lines.forEach((line, i) => {
    if (line.kind === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true
  })
  const rows: DiffRow[] = []
  lines.forEach((line, i) => {
    if (keep[i]) return rows.push(line)
    const last = rows[rows.length - 1]
    if (last?.kind === 'skip') last.count++
    else rows.push({ kind: 'skip', count: 1 })
  })
  return rows
}
