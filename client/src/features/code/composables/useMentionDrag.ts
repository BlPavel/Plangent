import { writeMentionDrag } from '@features/agent-chat'
import { useCodeContext } from '../stores/context'

/** All code sources carry the folder of their own store instance. */
export function useMentionDrag(store = useCodeContext()) {
  return (event: DragEvent, path: string, dir = false, startLine?: number, endLine?: number) => {
    if (!store.projectId) { event.preventDefault(); return }
    writeMentionDrag(event.dataTransfer, { projectId: store.projectId, workspaceId: store.workspaceId ?? null, path, dir, startLine, endLine })
  }
}
