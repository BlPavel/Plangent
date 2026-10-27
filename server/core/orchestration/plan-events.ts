import { EventEmitter } from 'node:events';

export interface PlanSaved {
  taskId: string;
  content: string;
  previousContent: string;
  version: number;
  sessionId: string | null;
  idMap: Record<string, string>;
  removedSteps?: string[];
}
const events = new EventEmitter();
/** Domain notification, independent of the WebSocket protocol and its consumers. */
export function onPlanSaved(listener: (event: PlanSaved) => void): () => void {
  events.on('saved', listener);
  return () => { events.off('saved', listener); };
}
export function emitPlanSaved(event: PlanSaved): void { events.emit('saved', event); }
