import { getDb } from '../../../schema';

export const assertUnfrozenSelectSqliteMaster = (...params: unknown[]) => getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_queues'").get(...params);
export const rowSelectTaskQueues = (...params: unknown[]) => getDb().prepare('SELECT data FROM task_queues WHERE task_id=?').get(...params);
