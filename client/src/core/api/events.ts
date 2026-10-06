// One shared, self-reconnecting connection to /ws/events.
type Handler = (event: { type: string }) => void
const handlers = new Set<Handler>()
const codeProjects = new Map<string, number>()
let socket: WebSocket | undefined
let reconnect: ReturnType<typeof setTimeout> | undefined

function send(type: string, projectId: string) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, projectId }))
}
function connect() {
  if (socket || (!handlers.size && !codeProjects.size)) return
  clearTimeout(reconnect)
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/events`)
  socket = current
  current.onopen = () => {
    for (const projectId of codeProjects.keys()) send('code:subscribe', projectId)
    for (const handler of handlers) handler({ type: 'events:connected' })
  }
  current.onmessage = message => {
    let event: { type: string }
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

export function onServerEvent<T extends { type: string } = { type: string }>(handler: (event: T) => void): () => void {
  const h = handler as Handler
  handlers.add(h)
  connect()
  return () => { handlers.delete(h); idle() }
}

/** Reference counted so multiple code screens can share a project watcher. */
export function subscribeCodeProject(projectId: string): () => void {
  const count = codeProjects.get(projectId) ?? 0
  codeProjects.set(projectId, count + 1)
  connect()
  if (!count) send('code:subscribe', projectId)
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    const remaining = (codeProjects.get(projectId) ?? 1) - 1
    if (remaining) codeProjects.set(projectId, remaining)
    else { codeProjects.delete(projectId); send('code:unsubscribe', projectId) }
    idle()
  }
}
