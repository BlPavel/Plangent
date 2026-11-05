import { getDb } from '../../../schema';

export const listMaterialsSelectMaterials = (...params: unknown[]) => getDb().prepare('SELECT * FROM materials WHERE task_id=? AND type=? ORDER BY version DESC').all(...params);
export const getLatestMaterialSelectMaterials = (...params: unknown[]) => getDb().prepare('SELECT * FROM materials WHERE task_id=? AND type=? ORDER BY version DESC LIMIT 1').get(...params);
export const materialInsertMaterials = (...params: unknown[]) => getDb().prepare('INSERT INTO materials (id,task_id,type,content,version,author,session_id) VALUES (?,?,?,?,?,?,?)').run(...params);
