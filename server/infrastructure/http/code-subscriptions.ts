import { WebSocket } from 'ws';
import { getProject } from '../../core/projects';
import { subscribeCode } from '../../core/code/watcher';

/**
 * /ws/events messages:
 * { type: 'code:subscribe', projectId }, { type: 'code:unsubscribe', projectId }.
 * Replies: code:subscribed / code:unsubscribed / code:error; changes: code:changed.
 * Resubscribe after reconnect; refresh tree/status/file after code:subscribed to avoid missed changes.
 */
export function attachCodeSubscriptions(ws: WebSocket): void {
  const subscriptions = new Map<string, () => void>();
  const send = (event: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };
  ws.on('message', data => {
    const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
    if (bytes.length > 8192) return;
    let message: { type?: string; projectId?: string };
    try { message = JSON.parse(bytes.toString()); } catch { return; }
    if (!message || !['code:subscribe', 'code:unsubscribe'].includes(message.type ?? '')) return;
    const projectId = message.projectId;
    if (typeof projectId !== 'string' || !projectId || projectId.length > 128) {
      send({ type: 'code:error', error: 'Invalid project ID' }); return;
    }
    if (message.type === 'code:unsubscribe') {
      subscriptions.get(projectId)?.();
      subscriptions.delete(projectId);
      send({ type: 'code:unsubscribed', projectId }); return;
    }
    try {
      if (!subscriptions.has(projectId)) {
        if (subscriptions.size >= 32) throw new Error('Too many subscriptions');
        const project = getProject(projectId);
        if (!project || project.kind === 'group') throw new Error('Project not found');
        subscriptions.set(projectId, subscribeCode(project.repo_path, projectId, send));
      }
      send({ type: 'code:subscribed', projectId });
    } catch { send({ type: 'code:error', projectId, error: 'Cannot watch project; use manual refresh' }); }
  });
  ws.once('close', () => {
    for (const stop of subscriptions.values()) stop();
    subscriptions.clear();
  });
}
