// One shared, self-reconnecting connection to the server's event stream (/ws/events).
// Subscribers get every event and filter what they need.
type Handler = (event: { type: string }) => void

const handlers = new Set<Handler>()
let socket: WebSocket | undefined

function connect() {
  if (socket) return
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/events`)
  socket.onmessage = message => {
    let event: { type: string }
    try { event = JSON.parse(message.data) } catch { return }
    for (const handler of handlers) handler(event)
  }
  socket.onclose = () => {
    socket = undefined
    setTimeout(() => { if (handlers.size) connect() }, 2000)
  }
}

/** Subscribe to server events; returns the unsubscribe function. */
export function onServerEvent<T extends { type: string } = { type: string }>(handler: (event: T) => void): () => void {
  const h = handler as Handler
  handlers.add(h)
  connect()
  return () => { handlers.delete(h) }
}
