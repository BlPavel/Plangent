import { WebSocket } from 'ws';

const clients = new Set<WebSocket>();

export function addEventsClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export function broadcast(event: { type: string; [key: string]: unknown }): void {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}
