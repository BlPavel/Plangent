import type { ContentBlock } from '../../infrastructure/acp/types';
import type { AgentSession, Agent } from '../../models';
import { getAgent } from './catalog';
import { createSession, getSession, updateSession } from './sessions/sessions';
import { sendPrompt, startSession, sessionSignals } from './sessions/acp-host';
import { resolveAgentChoice } from '../settings';
export { resolveAgentChoice } from '../settings';
import { DomainError } from '../../models/domain-error';

export function selectAgent(projectId: string, choices: Parameters<typeof resolveAgentChoice>[1] = {}): Agent | null {
  return getAgent(resolveAgentChoice(projectId, choices).agentId);
}

export function createAgentSession(data: Parameters<typeof createSession>[0] & { mode?: string; config?: Record<string, string> }): AgentSession {
  const { mode, config, ...session } = data;
  return createSession({ ...session, metadata: { ...session.metadata, ...(mode ? { preferredMode: mode } : {}), ...(config ? { preferredConfig: config } : {}) } });
}

/** Delivery errors follow one policy; callers may additionally update their own domain state. */
export function runAgentWork(id: string): Promise<void>;
export function runAgentWork(id: string, content: ContentBlock[], gitForTurn?: boolean): Promise<void>;
export async function runAgentWork(id: string, content?: ContentBlock[], gitForTurn = false): Promise<void> {
  try { if (content) await sendPrompt(id, content, gitForTurn); else await startSession(id); }
  catch (error) { updateSession(id, { status: 'error', reason: String(error) }); throw error; }
}

export function agentPreferences(mode: unknown, config: unknown): Record<string, unknown> {
  return { ...(typeof mode === 'string' && mode ? { preferredMode: mode } : {}),
    ...(config && typeof config === 'object' ? { preferredConfig: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value)])) } : {}) };
}

export function onAgentEvent(event: string, listener: (id: string, reason: string) => void): () => void {
  sessionSignals.on(event, listener);
  return () => { sessionSignals.off(event, listener); };
}

/** Install before starting a turn. Dispose also cancels its timeout and both listeners. */
export function waitForAgentTurn(id: string, timeoutMs = 120_000) {
  let dispose = () => {};
  const result = new Promise<AgentSession>((resolve, reject) => {
    const done = (sessionId: string) => { if (sessionId === id) { dispose(); resolve(getSession(id)); } };
    const failed = (sessionId: string, reason: string) => { if (sessionId === id) { dispose(); reject(new DomainError(reason)); } };
    const timer = setTimeout(() => { dispose(); reject(new DomainError('Agent turn timed out')); }, timeoutMs);
    sessionSignals.on('turn_end', done);
    sessionSignals.on('error-state', failed);
    dispose = () => { clearTimeout(timer); sessionSignals.off('turn_end', done); sessionSignals.off('error-state', failed); };
  });
  return { result, dispose: () => dispose() };
}

export function completeAgentWork(id: string, summary: string): boolean {
  const session = getSession(id);
  if (session.status === 'complete' || session.metadata.step_completed
    || session.role === 'errand' && (session.metadata.work_done || session.metadata.auto_review_turn)) return false;
  // Errands commit completion only after a successful turn; interrupted completion can be retried.
  if (session.role === 'executor') updateSession(id, { metadata: { ...session.metadata, step_completed: true } });
  updateSession(id, { status: 'complete', reason: summary });
  markAgentWorkFinished(id);
  sessionSignals.emit('complete', id, summary);
  return true;
}
/** The owner has saved the result; let the agent finish its current turn before reclaiming its process. */
export function markAgentWorkFinished(id: string): void {
  const session = getSession(id);
  updateSession(id, { metadata: { ...session.metadata, workFinishedAt: Date.now() } });
}
export function requestAgentHelp(id: string, question: string): void {
  updateSession(id, { status: 'waiting', reason: question });
  sessionSignals.emit('help', id, question);
}
