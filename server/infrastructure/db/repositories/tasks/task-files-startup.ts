import { getDb } from '../../schema';

export const initTaskFilesSelectTasks = (...params: unknown[]) => getDb().prepare('SELECT * FROM tasks').all(...params);
