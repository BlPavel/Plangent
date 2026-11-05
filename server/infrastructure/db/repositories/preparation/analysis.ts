import { getDb } from '../../schema';

export const listAnalysisSectionsSelectAnalysisSections = (...params: unknown[]) => getDb().prepare('SELECT * FROM analysis_sections WHERE task_id=? ORDER BY position, created_at, id').all(...params);
export const getAnalysisSectionSelectAnalysisSections = (...params: unknown[]) => getDb().prepare('SELECT * FROM analysis_sections WHERE id=?').get(...params);
export const listAnalysisFilesSelectAnalysisFiles = (...params: unknown[]) => getDb().prepare('SELECT * FROM analysis_files WHERE section_id=? ORDER BY created_at, id').all(...params);
export const getAnalysisFileSelectAnalysisFiles = (...params: unknown[]) => getDb().prepare('SELECT * FROM analysis_files WHERE id=?').get(...params);
export const createAnalysisSectionInsertAnalysisSections = (...params: unknown[]) => getDb().prepare('INSERT INTO analysis_sections (id, task_id, slug, title, description, kind, author, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...params);
export const updateAnalysisSectionUpdateAnalysisSections = (...params: unknown[]) => getDb().prepare("UPDATE analysis_sections SET title=?, description=?, kind=?, updated_at=datetime('now') WHERE id=?").run(...params);
export const statementUpdateAnalysisSections = (...params: unknown[]) => getDb().prepare("UPDATE analysis_sections SET position=?, updated_at=datetime('now') WHERE id=?").run(...params);
export const deleteAnalysisSectionDeleteAnalysisSections = (...params: unknown[]) => getDb().prepare('DELETE FROM analysis_sections WHERE id=?').run(...params);
export const addAnalysisFileInsertAnalysisFiles = (...params: unknown[]) => getDb().prepare('INSERT INTO analysis_files (id, section_id, name, mime, size, content) VALUES (?, ?, ?, ?, ?, ?)').run(...params);
export const deleteAnalysisFileDeleteAnalysisFiles = (...params: unknown[]) => getDb().prepare('DELETE FROM analysis_files WHERE id=?').run(...params);
export const statementUpdateAnalysisSections2 = (...params: unknown[]) => getDb().prepare("UPDATE analysis_sections SET description=?, updated_at=datetime('now') WHERE id=?").run(...params);
export const statementUpdateAnalysisSections3 = (...params: unknown[]) => getDb().prepare("UPDATE analysis_sections SET description=?, updated_at=datetime('now') WHERE id=? AND task_id=?").run(...params);
