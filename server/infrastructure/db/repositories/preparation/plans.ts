import { getDb } from '../../schema';

export const rowSelectPlans = (...params: unknown[]) => getDb().prepare('SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC LIMIT 1').get(...params);
export const rowSelectPlans2 = (...params: unknown[]) => getDb().prepare('SELECT * FROM plans WHERE id = ?').get(...params);
export const rowsSelectPlans = (...params: unknown[]) => getDb().prepare('SELECT * FROM plans WHERE task_id = ? ORDER BY version DESC').all(...params);
export const createPlanInsertPlans = (...params: unknown[]) => getDb().prepare(`
    INSERT INTO plans (id, task_id, content, version, session_id, author) VALUES (?, ?, ?, ?, ?, ?)
  `).run(...params);
export const updatePlanUpdatePlans = (...params: unknown[]) => getDb().prepare(`
    UPDATE plans SET content=?, session_id=?, author=?, updated_at=datetime('now') WHERE id=?
  `).run(...params);
