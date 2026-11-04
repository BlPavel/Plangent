import { onServerEvent, sendServerMessage } from '@core/api/events'

const projects = new Map<string, { projectId: string; workspaceId?: string; count: number }>()
let stop: (() => void) | undefined
const send = (type: string, projectId: string, workspaceId?: string) => sendServerMessage({ type, projectId, workspaceId })

/** Replays active subscriptions after reconnect; each consumer owns one reference. */
export function subscribeCodeProject(projectId: string, workspaceId?: string): () => void {
  const key = JSON.stringify([projectId, workspaceId ?? null])
  const previous = projects.get(key)
  projects.set(key, { projectId, workspaceId, count: (previous?.count ?? 0) + 1 })
  stop ??= onServerEvent(event => {
    if (event.type === 'events:connected') for (const value of projects.values()) send('code:subscribe', value.projectId, value.workspaceId)
  })
  if (!previous) send('code:subscribe', projectId, workspaceId)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const value = projects.get(key)
    if (value && --value.count > 0) return
    projects.delete(key)
    send('code:unsubscribe', projectId, workspaceId)
    if (!projects.size) { stop?.(); stop = undefined }
  }
}
