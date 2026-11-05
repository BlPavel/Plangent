import { DomainError } from '../../../models/domain-error';
import { runAgentWork, waitForAgentTurn } from '../../agents';

export interface ReviewThread<Binding, Kind extends string, Status extends string> {
  id: string;
  binding: Binding;
  author: string;
  kind: Kind;
  status: Status;
}
export interface ReviewMessage { author: string; sent: boolean }
export const replyKinds = ['answer', 'options', 'questions', 'change', 'disagree'] as const;
export type ReplyKind = typeof replyKinds[number];

/** Each variant explicitly limits which replies its agent is allowed to produce. */
export function parseReply(input: { kind?: unknown; text?: unknown }, allowed: readonly string[] = replyKinds) {
  const kind = String(input.kind ?? '');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!allowed.includes(kind) || !text) throw new DomainError(`Invalid reply: kind is ${allowed.join('|')} and text is required`);
  return { kind: kind as ReplyKind, text };
}
export const hasQueuedReplies = (messages: readonly ReviewMessage[]) => messages.some(m => m.author === 'developer' && !m.sent);
export const awaitingReply = (messages: readonly ReviewMessage[]) => {
  const last = messages.at(-1);
  return !!last && last.author === 'developer' && last.sent;
};
export function pendingThreads<T>(threads: readonly T[], messages: (thread: T) => readonly ReviewMessage[], fresh: (thread: T) => boolean = () => false): T[] {
  return threads.filter(thread => fresh(thread) || hasQueuedReplies(messages(thread)));
}

/** Capture/rollback belongs to the variant's repository; delivery follows one policy. */
export async function sendReviewBatch(sessionId: string, text: string, rollback?: () => void,
  deliver: (id: string, content: { type: 'text'; text: string }[]) => Promise<void> = runAgentWork) {
  try { await deliver(sessionId, [{ type: 'text', text }]); }
  catch (error) { rollback?.(); throw error; }
}
export async function runReviewTurn(sessionId: string, text: string, timeoutMs?: number) {
  const turn = waitForAgentTurn(sessionId, timeoutMs);
  try {
    const [, session] = await Promise.all([sendReviewBatch(sessionId, text), turn.result]);
    return session;
  }
  finally { turn.dispose(); }
}
export function reviewBrief<P, S, C>(protocol: P, skill: S, context: C) { return { protocol, skill, ...context }; }

export type ReviewPhase = 'idle' | 'running' | 'reported';
export function reviewTransition<S extends string>(current: S, event: 'start' | 'report', phases: Record<ReviewPhase, S>, message?: string): S {
  if (event === 'start') {
    if (current !== phases.idle) throw new DomainError(message ?? 'Start a new review first', 409);
    return phases.running;
  }
  if (current !== phases.running) throw new DomainError(message ?? 'Review is not running', 409);
  return phases.reported;
}
