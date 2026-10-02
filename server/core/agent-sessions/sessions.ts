import { randomUUID } from 'crypto';
import { getDb } from '../../infrastructure/db/schema';
import { broadcast } from '../shared/events';
import type { AgentSession, SessionEvent } from './types';

export function initSessions(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      step_ids TEXT NOT NULL DEFAULT '[]', role TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agents(id),
      model TEXT NOT NULL DEFAULT '', acp_session_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', policy TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agent_session_events (
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(session_id, seq)
    );
    CREATE TABLE IF NOT EXISTS agent_prompt_queue (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS review_findings (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      file TEXT NOT NULL, line INTEGER NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL
    );
    UPDATE agent_sessions SET status='waiting', reason='Приложение перезапущено. Продолжите сессию.'
      WHERE status IN ('starting', 'thinking', 'waiting');
  `);
}
function parse(row: unknown): AgentSession {
  const r = row as AgentSession & { step_ids: string; metadata: string };
  return { ...r, step_ids: JSON.parse(r.step_ids), metadata: JSON.parse(r.metadata) };
}
export function getSession(id: string): AgentSession {
  const row = getDb().prepare('SELECT * FROM agent_sessions WHERE id=?').get(id);
  if (!row) throw new Error('Сессия не найдена');
  return parse(row);
}
export function listSessions(projectId?: string): AgentSession[] {
  return (projectId ? getDb().prepare('SELECT * FROM agent_sessions WHERE project_id=? ORDER BY created_at DESC').all(projectId)
    : getDb().prepare('SELECT * FROM agent_sessions ORDER BY created_at DESC').all()).map(parse);
}
export function createSession(data: Pick<AgentSession, 'project_id' | 'agent_id' | 'role' | 'policy'> & Partial<AgentSession>): AgentSession {
  if (data.role === 'librarian') data = { ...data, policy: 'read-only' };
  const id = randomUUID();
  getDb().prepare(`INSERT INTO agent_sessions
    (id, project_id, task_id, run_id, step_ids, role, agent_id, model, title, status, policy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?)`).run(id, data.project_id, data.task_id ?? null,
    data.run_id ?? null, JSON.stringify(data.step_ids ?? []), data.role, data.agent_id, data.model ?? '', data.title ?? 'Новый чат', data.policy);
  if (data.metadata) getDb().prepare('UPDATE agent_sessions SET metadata=? WHERE id=?').run(JSON.stringify(data.metadata), id);
  return getSession(id);
}
export function updateSession(id: string, data: Partial<AgentSession>): AgentSession {
  if (data.policy && data.policy !== 'read-only' && getSession(id).role === 'librarian') throw new Error('Librarian sessions are read-only');
  const allowed = ['title', 'status', 'reason', 'model', 'acp_session_id', 'policy', 'metadata'];
  const entries = Object.entries(data).filter(([key]) => allowed.includes(key));
  if (entries.length) getDb().prepare(`UPDATE agent_sessions SET ${entries.map(([k]) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`)
    .run(...entries.map(([k, v]) => k === 'metadata' ? JSON.stringify(v) : v), id);
  const session = getSession(id);
  broadcast({ type: 'agent_session', session });
  return session;
}
export function addEvent(id: string, type: string, payload: Record<string, unknown>): SessionEvent {
  const db = getDb();
  const event = db.transaction(() => {
    const { seq } = db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM agent_session_events WHERE session_id=?').get(id) as { seq: number };
    db.prepare('INSERT INTO agent_session_events(session_id,seq,type,payload) VALUES (?,?,?,?)').run(id, seq, type, JSON.stringify(payload));
    return { session_id: id, seq, type, payload, created_at: new Date().toISOString() };
  })();
  broadcast({ type: 'agent_event', event });
  return event;
}
export function history(id: string): SessionEvent[] {
  getSession(id);
  return (getDb().prepare('SELECT * FROM agent_session_events WHERE session_id=? ORDER BY seq').all(id) as (SessionEvent & { payload: string })[])
    .map(e => ({ ...e, payload: JSON.parse(e.payload) }));
}
export function deleteSession(id: string): void {
  getDb().prepare('DELETE FROM agent_sessions WHERE id=?').run(id);
  broadcast({ type: 'agent_session_deleted', sessionId: id });
}
export interface ReviewFinding { id: string; session_id: string; file: string; line: number; severity: 'low' | 'medium' | 'high' | 'critical'; message: string }
export function findings(sessionId: string): ReviewFinding[] {
  getSession(sessionId);
  return getDb().prepare('SELECT * FROM review_findings WHERE session_id=?').all(sessionId) as ReviewFinding[];
}
