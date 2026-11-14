import { getDb } from '../../../schema';

export const marksSelectPreparationMarks = (...params: unknown[]) => getDb().prepare('SELECT * FROM preparation_marks WHERE task_id=?').all(...params);
export const writeInsertPreparationMarks = (...params: unknown[]) => getDb().prepare(`INSERT INTO preparation_marks (task_id,stage,status,material_version) VALUES (?,?,?,?)
      ON CONFLICT(task_id,stage) DO UPDATE SET status=excluded.status,material_version=excluded.material_version,
      marked_at=strftime('%Y-%m-%d %H:%M:%f','now')`).run(...params);
