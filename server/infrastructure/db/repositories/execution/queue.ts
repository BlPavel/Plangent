import { getDb } from '../../schema';

export function initQueueTable(): void {
  getDb().exec(`CREATE TABLE IF NOT EXISTS task_queues (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export const initQueuesSelectAgentSessions = (...params: unknown[]) => getDb().prepare('SELECT 1 FROM agent_sessions WHERE id=?').get(...params);
export const allQueuesSelectTaskQueues = (...params: unknown[]) => getDb().prepare('SELECT data FROM task_queues').all(...params);
export const rowSelectTaskQueues = (...params: unknown[]) => getDb().prepare('SELECT data FROM task_queues WHERE task_id=?').get(...params);
export const saveQueueInsertTaskQueues = (...params: unknown[]) => getDb().prepare(`INSERT INTO task_queues (task_id, data, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(task_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`).run(...params);
export const rowSelectAgentSessions = (...params: unknown[]) => getDb().prepare('SELECT status FROM agent_sessions WHERE id=?').get(...params);
export const rowSelectTaskQueues2 = (...params: unknown[]) => getDb().prepare('SELECT data FROM task_queues WHERE task_id=?').get(...params);
