import { getDb } from '../../schema';

export const moveTaskSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT 1 FROM tasks WHERE project_id=? AND key=?').get(...params);
export const moveTaskUpdateTasks = (...params: unknown[]) => getDb().prepare('UPDATE tasks SET project_id=? WHERE id=?').run(...params);
export const moveTaskUpdateAgentSessions = (...params: unknown[]) => getDb().prepare('UPDATE agent_sessions SET project_id=? WHERE task_id=?').run(...params);
export const moveTaskSelectTaskQueues = (...params: unknown[]) => getDb().prepare('SELECT 1 FROM task_queues WHERE task_id=?').get(...params);
