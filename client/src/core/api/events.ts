import type { ServerEvent } from '@contracts'
export type { ServerEvent } from '@contracts'
type Handler = (event: ServerEvent) => void
const handlers = new Set<Handler>()
let socket: WebSocket | undefined
let reconnect: ReturnType<typeof setTimeout> | undefined
export function sendServerMessage(message: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}
function connect() {
  if (socket || !handlers.size) return
  clearTimeout(reconnect)
  const current = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/events`)
  socket = current
  current.onopen = () => { for (const handler of handlers) handler({ type: 'events:connected' }) }
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
    if (handlers.size) reconnect = setTimeout(connect, 2000)
  }
}
export function onServerEvent<T extends { type: string } = ServerEvent>(handler: (event: T) => void): () => void {
  const h = handler as Handler
  handlers.add(h)
  connect()
  return () => {
    handlers.delete(h)
    if (handlers.size) return
    clearTimeout(reconnect)
    const current = socket
    socket = undefined
    current?.close()
  }
}
