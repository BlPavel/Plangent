import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { attachCodeSubscriptions } from './code-subscriptions';
import { attachSocket } from '../../core/terminals';
import { addEventsClient } from '../../core/shared/events';

export function attachWebSockets(server: Server): void {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url!, 'http://localhost');

    if (url.pathname === '/ws/events') {
      addEventsClient(ws);
      attachCodeSubscriptions(ws);
      return;
    }

    if (url.pathname === '/ws/pty') {
      const sessionId = url.searchParams.get('session');
      if (!sessionId) { ws.close(1008, 'session required'); return; }
      const ok = attachSocket(sessionId, ws);
      if (!ok) {
        ws.send(JSON.stringify({ type: 'error', message: `Session '${sessionId}' not found` }));
        ws.close(1011, 'session not found');
      }
      return;
    }

    ws.close(1008, 'unknown path');
  });
}
