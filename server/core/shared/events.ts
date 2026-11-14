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

type Event = { type: string; [key: string]: unknown };

function deliver(event: Event): void {
  signals.emit('broadcast', event);
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// A streamed answer arrives in tiny chunks; every client would parse and render each one. Chunks of the
// same message are merged and sent together. Any other event goes out after the chunks queued before it.
const DELTA_WINDOW_MS = 40;
const deltas: Event[] = [];
let deltaTimer: ReturnType<typeof setTimeout> | undefined;

function flushDeltas(): void {
  clearTimeout(deltaTimer);
  deltaTimer = undefined;
  for (const delta of deltas.splice(0)) deliver(delta);
}

export function broadcast(event: Event): void {
  if (event.type !== 'agent_delta') {
    flushDeltas();
    deliver(event);
    return;
  }
  const last = deltas[deltas.length - 1];
  if (last && last.sessionId === event.sessionId && last.kind === event.kind) last.text = String(last.text) + String(event.text);
  else deltas.push({ ...event });
  deltaTimer ??= setTimeout(flushDeltas, DELTA_WINDOW_MS);
}
