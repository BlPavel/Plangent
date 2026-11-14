import { getDb } from '../../schema';

export const reopenWorkWorkspaces = (...params: unknown[]) => getDb().prepare('SELECT id FROM workspaces WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(...params);
export const errandFromWorkAnalysisSections = (...params: unknown[]) => getDb().prepare('SELECT title,description FROM analysis_sections WHERE task_id=? ORDER BY position').all(...params);
