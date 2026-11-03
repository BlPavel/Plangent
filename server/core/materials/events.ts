import { EventEmitter } from 'node:events';
import type { MaterialType } from './index';

export interface MaterialSaved {
  taskId: string;
  type: MaterialType;
  content: string;
  previousContent: string;
  version: number;
  sessionId: string | null;
}
const events = new EventEmitter();
/** Domain notification, independent of the WebSocket protocol: the review of a material subscribes to it. */
export function onMaterialSaved(listener: (event: MaterialSaved) => void): () => void {
  events.on('saved', listener);
  return () => { events.off('saved', listener); };
}
export function emitMaterialSaved(event: MaterialSaved): void { events.emit('saved', event); }
