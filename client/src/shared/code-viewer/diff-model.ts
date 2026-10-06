export interface DiffLine {
  type: ' ' | '+' | '-'
  text: string
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

/** Change shown on the margin in "file" mode. `deleted` is a triangle before the line. */
export type StripeKind = 'added' | 'modified' | 'deleted'

export type DiffRow =
  | { kind: 'context' | 'added'; newLine: number; oldLine?: number }
  | { kind: 'deleted'; oldLine: number; text: string }
  | { kind: 'fold'; start: number; count: number }

/** One contiguous run of added/removed lines; the unit of ↑↓ navigation. */
export interface ChangeBlock {
  /** First new-side line of the block (the line after it for pure deletions). */
  newLine: number
  added: number
  deleted: number
}

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parses the hunks of a single-file unified diff; file headers and binary notices yield nothing. */
export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const input = diff.split('\n')
  for (let i = 0; i < input.length; i++) {
    const match = HEADER.exec(input[i])
    if (!match) continue
    const hunk: DiffHunk = {
      oldStart: Number(match[1]), oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]), newLines: match[4] === undefined ? 1 : Number(match[4]), lines: [],
    }
    let oldLeft = hunk.oldLines
    let newLeft = hunk.newLines
    // Counts, not prefixes, end the hunk: a removed line "-- x" looks like a file header.
    while ((oldLeft > 0 || newLeft > 0) && i + 1 < input.length) {
      const raw = input[++i]
      const mark = raw[0]
      const text = raw.slice(1).replace(/\r$/, '')
      if (mark === '\\') continue
      if (mark === '+') { hunk.lines.push({ type: '+', text }); newLeft-- }
      else if (mark === '-') { hunk.lines.push({ type: '-', text }); oldLeft-- }
      else { hunk.lines.push({ type: ' ', text }); oldLeft--; newLeft-- }
    }
    hunks.push(hunk)
  }
  return hunks
}

/** Totals for the `+N −M` counter. */
export function diffStats(hunks: DiffHunk[]): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const hunk of hunks) for (const line of hunk.lines) {
    if (line.type === '+') added++
    else if (line.type === '-') deleted++
  }
  return { added, deleted }
}

/** Walks every hunk and yields the change blocks with their positions on both sides. */
export function changeBlocks(hunks: DiffHunk[]): ChangeBlock[] {
  const blocks: ChangeBlock[] = []
  for (const hunk of hunks) {
    let newLine = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart
    let current: ChangeBlock | null = null
    for (const line of hunk.lines) {
      if (line.type === ' ') { current = null; newLine++; continue }
      if (!current) { current = { newLine, added: 0, deleted: 0 }; blocks.push(current) }
      if (line.type === '+') { current.added++; newLine++ } else current.deleted++
    }
  }
  return blocks
}

/** Margin stripes by new-side line: a removal followed by additions marks those lines as modified. */
export function stripes(hunks: DiffHunk[], lineCount: number): Map<number, StripeKind> {
  const result = new Map<number, StripeKind>()
  for (const block of changeBlocks(hunks)) {
    if (block.added === 0) {
      if (lineCount > 0) result.set(Math.min(block.newLine, lineCount), 'deleted')
    } else {
      const kind: StripeKind = block.deleted > 0 ? 'modified' : 'added'
      for (let n = 0; n < block.added; n++) result.set(block.newLine + n, kind)
    }
  }
  return result
}

/** Rows of the "file" mode: every line of the new side, nothing else. */
export function fileRows(lineCount: number): DiffRow[] {
  return Array.from({ length: lineCount }, (_, i) => ({ kind: 'context', newLine: i + 1 }) as DiffRow)
}

/**
 * Rows of the Diff mode. Unchanged lines come from the new content, removed ones from the hunks
 * (which already carry their own context lines); the stretches between hunks are collapsed into
 * fold rows unless their start line is in `expanded` or `expandAll` is set.
 */
export function diffRows(hunks: DiffHunk[], lineCount: number, options: { expanded?: ReadonlySet<number>; expandAll?: boolean } = {}): DiffRow[] {
  const rows: DiffRow[] = []
  let next = 1
  const unchanged = (from: number, to: number) => {
    const count = to - from + 1
    if (count <= 0) return
    if (options.expandAll || count === 1 || options.expanded?.has(from)) {
      for (let n = from; n <= to; n++) rows.push({ kind: 'context', newLine: n })
    } else rows.push({ kind: 'fold', start: from, count })
  }
  for (const hunk of hunks) {
    // A hunk with no new lines (a deletion) is anchored after line newStart.
    const start = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart
    unchanged(next, start - 1)
    let newLine = start
    let oldLine = hunk.oldStart
    for (const line of hunk.lines) {
      if (line.type === '-') rows.push({ kind: 'deleted', oldLine: oldLine++, text: line.text })
      else if (line.type === '+') { rows.push({ kind: 'added', newLine }); newLine++ }
      else { rows.push({ kind: 'context', newLine, oldLine }); newLine++; oldLine++ }
    }
    next = newLine
  }
  unchanged(next, lineCount)
  return rows
}
