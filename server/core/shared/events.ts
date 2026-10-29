import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

const signals = new EventEmitter();
export const onBroadcast = (handler: (event: { type: string; [key: string]: unknown }) => void) => {
  signals.on('broadcast', handler); return () => { signals.off('broadcast', handler); };
};

const clients = new Set<WebSocket>();

export function addEventsClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export function broadcast(event: { type: string; [key: string]: unknown }): void {
  signals.emit('broadcast', event);
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}
