export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'

/** One entry of a directory level; structurally compatible with the server TreeEntry. */
export interface TreeNode {
  name: string
  path: string
  directory: boolean
  ignored: boolean
  status?: ChangeStatus
  changes: number
}

/** File content as the viewer shows it; structurally compatible with the server CodeFile. */
export interface ViewerFile {
  path: string
  size: number
  kind: 'text' | 'image' | 'binary' | 'too-large'
  content?: string
}

export type CodeSide = 'new' | 'old'

/** A line or range chosen in the gutter. Lines are 1-based and inclusive. */
export interface LineSelection {
  path: string
  side: CodeSide
  startLine: number
  endLine: number
}

/** A margin marker (comment icon) next to a line number. */
export interface LineMarker {
  line: number
  count?: number
  title?: string
}
