export interface ActiveSession {
  sessionId: string;
  mode: 'tmux' | 'pty';
  projectId: string;
  taskId: string;
}

const sessions = new Map<string, ActiveSession>();  // runId → session

export function registerSession(runId: string, session: ActiveSession): void {
  sessions.set(runId, session);
}

export function getSession(runId: string): ActiveSession | undefined {
  return sessions.get(runId);
}

export function removeSession(runId: string): void {
  sessions.delete(runId);
}

