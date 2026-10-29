import type { Workspace } from '@core/models'
export interface ServerEvent { type: string; projectId?: string; taskId?: string; taskKey?: string; workspace?: Workspace | null }
export type WorkEvent = ServerEvent & { type: 'work:update' | 'work:ready_for_check' | 'work:fixes_ready' }
export type WorkspaceEvent = ServerEvent & { type: 'workspace:update' | 'workspace:viewing'; projectId: string; workspace: Workspace | null }
type Handler = (event: ServerEvent) => void
const handlers = new Set<Handler>()
const codeProjects = new Map<string, { projectId: string; workspaceId?: string; count: number }>()
let socket: WebSocket | undefined
let reconnect: ReturnType<typeof setTimeout> | undefined

function send(type: string, projectId: string, workspaceId?: string) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, projectId, workspaceId }))
}
function connect() {
  if (socket || (!handlers.size && !codeProjects.size)) return
  clearTimeout(reconnect)
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/events`)
  socket = current
  current.onopen = () => {
    for (const value of codeProjects.values()) send('code:subscribe', value.projectId, value.workspaceId)
    for (const handler of handlers) handler({ type: 'events:connected' })
  }
  current.onmessage = message => {
    let event: ServerEvent
    try { event = JSON.parse(message.data) } catch { return }
    if (!event || typeof event.type !== 'string') return
    for (const handler of handlers) handler(event)
  }
  current.onclose = () => {
    if (socket !== current) return
    socket = undefined
    for (const handler of handlers) handler({ type: 'events:disconnected' })
    reconnect = setTimeout(connect, 2000)
  }
}
function idle() {
  if (handlers.size || codeProjects.size) return
  clearTimeout(reconnect)
  const current = socket
  socket = undefined
  current?.close()
}
export function onServerEvent<T extends { type: string } = ServerEvent>(handler: (event: T) => void): () => void {
  const h = handler as Handler
  handlers.add(h)
  connect()
  return () => { handlers.delete(h); idle() }
}
export const onWorkEvent = (handler: (event: WorkEvent) => void) =>
  onServerEvent(event => { if (['work:update', 'work:ready_for_check', 'work:fixes_ready'].includes(event.type)) handler(event as WorkEvent) })
export const onWorkspaceEvent = (handler: (event: WorkspaceEvent) => void) =>
  onServerEvent(event => { if (['workspace:update', 'workspace:viewing'].includes(event.type)) handler(event as WorkspaceEvent) })

/** Independent reference counts for each project/workspace pair. */
export function subscribeCodeProject(projectId: string, workspaceId?: string): () => void {
  const key = JSON.stringify([projectId, workspaceId ?? null])
  const previous = codeProjects.get(key)
  codeProjects.set(key, { projectId, workspaceId, count: (previous?.count ?? 0) + 1 })
  connect()
  if (!previous) send('code:subscribe', projectId, workspaceId)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const value = codeProjects.get(key)
    if (value && --value.count > 0) return
    codeProjects.delete(key)
    send('code:unsubscribe', projectId, workspaceId)
    idle()
  }
}
