/** A project-relative reference, resolved by the receiving composer. */
export interface MentionDrag {
  projectId: string
  workspaceId: string | null
  path: string
  dir: boolean
  startLine?: number
  endLine?: number
}

export const MENTION_DRAG_TYPE = 'application/x-plangent-mention'

export function mentionText(mention: MentionDrag): string {
  const path = mention.path.replace(/\/$/, '')
  const lines = mention.startLine ? `:${mention.startLine}${mention.endLine && mention.endLine !== mention.startLine ? `-${mention.endLine}` : ''}` : ''
  return `@${path}${mention.dir ? '/' : lines}`
}

export function writeMentionDrag(transfer: DataTransfer | null, mention: MentionDrag) {
  if (!transfer) return
  transfer.setData(MENTION_DRAG_TYPE, JSON.stringify(mention))
  transfer.setData('text/plain', mentionText(mention))
  transfer.effectAllowed = 'copy'
}

export function readMentionDrag(transfer: DataTransfer | null): MentionDrag | null {
  try {
    const value = JSON.parse(transfer?.getData(MENTION_DRAG_TYPE) || '')
    const line = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
    if (!value || typeof value.projectId !== 'string' || !value.projectId ||
      !(value.workspaceId === null || typeof value.workspaceId === 'string') ||
      typeof value.path !== 'string' || !value.path || typeof value.dir !== 'boolean' ||
      (value.startLine !== undefined && !line(value.startLine)) ||
      (value.endLine !== undefined && (!line(value.endLine) || !line(value.startLine) || value.endLine < value.startLine)) ||
      (value.dir && (value.startLine !== undefined || value.endLine !== undefined))) return null
    return value
  } catch { return null }
}
